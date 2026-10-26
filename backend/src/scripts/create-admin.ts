/**
 * Creates or updates a portal user who can sign in with employee code + OTP.
 *   npm run admin:create -- --code ACS001 --name "Company Secretary" --email cs@example.com --role admin
 * Roles: admin (everything, including permanent deletion), publisher (upload, edit, publish), viewer (read only).
 */
import { parseArgs } from 'node:util';
import { env } from '../config/env';
import { createDatabase } from '../db/database';
import { runMigrations } from '../db/migrate';
import { AuditService, systemActor } from '../modules/audit/audit.service';
import { AuthService, Role } from '../modules/auth/auth.service';

async function main() {
  const { values } = parseArgs({
    options: {
      code: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
      role: { type: 'string', default: 'publisher' },
      inactive: { type: 'boolean', default: false },
    },
  });

  if (!values.code || !values.name) {
    throw new Error('Usage: npm run admin:create -- --code <employee code> --name <name> [--email <email>] [--role admin|publisher|viewer] [--inactive]');
  }
  if (!['admin', 'publisher', 'viewer'].includes(values.role!)) {
    throw new Error('Role must be admin, publisher or viewer.');
  }
  if (env.OTP_DELIVERY === 'smtp' && !values.email) {
    throw new Error('An email address is required when OTP_DELIVERY=smtp.');
  }

  const db = await createDatabase(env.DATABASE_URL);
  try {
    await runMigrations(db);
    const audit = new AuditService(db);
    const auth = new AuthService(db, audit, { send: async () => '' });
    const user = await auth.upsertUser({ employeeCode: values.code, name: values.name, email: values.email ?? null, role: values.role as Role, isActive: !values.inactive });
    await audit.record(systemActor('cli:create-admin'), { action: 'admin_user.upserted', entityType: 'admin_user', entityId: user.id, details: { employeeCode: user.employeeCode, role: user.role, active: !values.inactive } });
    console.log(`Saved ${user.role} "${user.name}" (${user.employeeCode})${values.inactive ? ' as inactive' : ''}.`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
