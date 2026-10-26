import crypto from 'node:crypto';
import { env } from '../../config/env';
import { Database } from '../../db/database';
import { AppError } from '../../utils/response';
import { AuditService } from '../audit/audit.service';
import { OtpDelivery } from './otp-delivery';

export type Role = 'admin' | 'publisher' | 'viewer';

export type AuthUser = {
  id: number;
  employeeCode: string;
  name: string;
  email: string | null;
  role: Role;
};

type UserRow = { id: number; employee_code: string; name: string; email: string | null; role: Role; is_active: boolean };

const OTP_LENGTH = 6;
const OTP_RESEND_INTERVAL_SECONDS = 30;
const OTP_MAX_PER_WINDOW = 5;
const OTP_WINDOW_MINUTES = 15;

const toAuthUser = (row: UserRow): AuthUser => ({
  id: row.id,
  employeeCode: row.employee_code,
  name: row.name,
  email: row.email,
  role: row.role,
});

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export class AuthService {
  // Without AUTH_SECRET (development) OTP hashes are keyed per process; production requires a configured secret.
  private readonly secret = env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly delivery: OtpDelivery,
  ) {}

  private hashOtp(userId: number, code: string): string {
    return crypto.createHmac('sha256', this.secret).update(`${userId}:${code}`).digest('hex');
  }

  private async findActiveUser(employeeCode: string): Promise<UserRow | null> {
    const result = await this.db.query<UserRow>(
      'SELECT id, employee_code, name, email, role, is_active FROM admin_users WHERE lower(employee_code) = lower($1)',
      [employeeCode.trim()],
    );
    const user = result.rows[0];
    return user && user.is_active ? user : null;
  }

  async requestOtp(employeeCode: string, ip: string | null): Promise<{ message: string; resendAfterSeconds: number }> {
    const genericMessage = 'If the employee code is registered, a one-time password has been sent to its registered contact.';
    const user = await this.findActiveUser(employeeCode);
    if (!user) {
      await this.audit.record({ id: null, label: `unknown:${employeeCode.slice(0, 40)}`, ip }, { action: 'auth.otp_requested_unknown', entityType: 'auth' });
      return { message: genericMessage, resendAfterSeconds: OTP_RESEND_INTERVAL_SECONDS };
    }

    const recent = await this.db.query<{ total: number; seconds_since_last: number | null }>(
      `SELECT count(*)::int AS total, EXTRACT(EPOCH FROM (now() - max(created_at)))::int AS seconds_since_last
       FROM auth_otps WHERE user_id = $1 AND created_at > now() - make_interval(mins => $2)`,
      [user.id, OTP_WINDOW_MINUTES],
    );
    const { total, seconds_since_last: sinceLast } = recent.rows[0];
    if (sinceLast !== null && sinceLast < OTP_RESEND_INTERVAL_SECONDS) {
      throw new AppError('OTP_RATE_LIMITED', `Please wait ${OTP_RESEND_INTERVAL_SECONDS - sinceLast} seconds before requesting another OTP.`, 429);
    }
    if (total >= OTP_MAX_PER_WINDOW) {
      throw new AppError('OTP_RATE_LIMITED', 'Too many OTP requests. Try again in a few minutes.', 429);
    }

    const code = String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
    await this.db.query(
      `UPDATE auth_otps SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`,
      [user.id],
    );
    await this.db.query(
      `INSERT INTO auth_otps (user_id, code_hash, expires_at, request_ip) VALUES ($1, $2, now() + make_interval(secs => $3), $4)`,
      [user.id, this.hashOtp(user.id, code), env.OTP_TTL_SECONDS, ip],
    );

    let destination: string;
    try {
      destination = await this.delivery.send({ employeeCode: user.employee_code, name: user.name, email: user.email }, code, env.OTP_TTL_SECONDS);
    } catch {
      throw new AppError('OTP_DELIVERY_FAILED', 'The OTP could not be delivered. Contact the portal administrator.', 502);
    }

    await this.audit.record({ id: user.id, label: user.employee_code, ip }, { action: 'auth.otp_requested', entityType: 'admin_user', entityId: user.id });
    return { message: `OTP sent to ${destination}.`, resendAfterSeconds: OTP_RESEND_INTERVAL_SECONDS };
  }

  async verifyOtp(employeeCode: string, otp: string, meta: { ip: string | null; userAgent: string | null }) {
    const invalid = new AppError('INVALID_OTP', 'The OTP is incorrect or has expired. Request a new OTP and try again.', 401);
    const user = await this.findActiveUser(employeeCode);
    if (!user || !/^\d{6}$/.test(otp)) throw invalid;

    const challenge = (
      await this.db.query<{ id: string; code_hash: string; attempts: number }>(
        `SELECT id, code_hash, attempts FROM auth_otps
         WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1`,
        [user.id],
      )
    ).rows[0];
    if (!challenge) throw invalid;

    if (challenge.attempts >= env.OTP_MAX_ATTEMPTS) {
      await this.db.query('UPDATE auth_otps SET consumed_at = now() WHERE id = $1', [challenge.id]);
      throw invalid;
    }

    const expected = Buffer.from(challenge.code_hash, 'hex');
    const actual = Buffer.from(this.hashOtp(user.id, otp), 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      await this.db.query('UPDATE auth_otps SET attempts = attempts + 1 WHERE id = $1', [challenge.id]);
      await this.audit.record({ id: user.id, label: user.employee_code, ip: meta.ip }, { action: 'auth.otp_failed', entityType: 'admin_user', entityId: user.id });
      throw invalid;
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const session = await this.db.transaction(async (tx) => {
      const consumed = await tx.query('UPDATE auth_otps SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL', [challenge.id]);
      if (consumed.rowCount !== 1) throw invalid;
      const created = await tx.query<{ expires_at: Date }>(
        `INSERT INTO auth_sessions (token_hash, user_id, expires_at, ip, user_agent)
         VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5) RETURNING expires_at`,
        [sha256(token), user.id, Math.round(env.SESSION_TTL_HOURS * 3600), meta.ip, meta.userAgent?.slice(0, 300) ?? null],
      );
      await tx.query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [user.id]);
      await this.audit.record({ id: user.id, label: user.employee_code, ip: meta.ip }, { action: 'auth.login', entityType: 'admin_user', entityId: user.id }, tx);
      return created.rows[0];
    });

    return { token, expiresAt: new Date(session.expires_at).toISOString(), user: toAuthUser(user) };
  }

  async authenticate(token: string): Promise<AuthUser | null> {
    if (!token || token.length > 200) return null;
    const result = await this.db.query<UserRow>(
      `SELECT u.id, u.employee_code, u.name, u.email, u.role, u.is_active
       FROM auth_sessions s JOIN admin_users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active`,
      [sha256(token)],
    );
    return result.rows[0] ? toAuthUser(result.rows[0]) : null;
  }

  async logout(token: string, user: AuthUser, ip: string | null): Promise<void> {
    await this.db.query('UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(token)]);
    await this.audit.record({ id: user.id, label: user.employeeCode, ip }, { action: 'auth.logout', entityType: 'admin_user', entityId: user.id });
  }

  /** Creates or updates an admin user (used by the create-admin script and tests). */
  async upsertUser(input: { employeeCode: string; name: string; email?: string | null; role: Role; isActive?: boolean }): Promise<AuthUser> {
    const result = await this.db.query<UserRow>(
      `INSERT INTO admin_users (employee_code, name, email, role, is_active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ((lower(employee_code))) DO UPDATE
         SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role, is_active = EXCLUDED.is_active, updated_at = now()
       RETURNING id, employee_code, name, email, role, is_active`,
      [input.employeeCode.trim(), input.name.trim(), input.email?.trim() || null, input.role, input.isActive ?? true],
    );
    return toAuthUser(result.rows[0]);
  }
}
