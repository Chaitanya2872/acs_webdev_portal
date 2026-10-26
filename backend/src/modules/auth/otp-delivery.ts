import { FastifyBaseLogger } from 'fastify';
import nodemailer from 'nodemailer';
import { env } from '../../config/env';

export type OtpRecipient = { employeeCode: string; name: string; email: string | null };

export interface OtpDelivery {
  /** Sends the code; returns a masked destination for the "sent to …" message. */
  send(recipient: OtpRecipient, code: string, ttlSeconds: number): Promise<string>;
}

const maskEmail = (email: string) => email.replace(/^(.)(.*)(@.*)$/, (_match, first: string, middle: string, domain: string) => `${first}${'*'.repeat(Math.max(1, middle.length))}${domain}`);

/** Development only: writes the code to the server log. Refused in production by validateProductionSecurityConfig. */
export class LogOtpDelivery implements OtpDelivery {
  constructor(private readonly logger: FastifyBaseLogger) {}

  async send(recipient: OtpRecipient, code: string): Promise<string> {
    this.logger.warn({ employeeCode: recipient.employeeCode, otp: code }, 'OTP_DELIVERY=log: one-time password (development only)');
    return 'the server log';
  }
}

export class SmtpOtpDelivery implements OtpDelivery {
  private readonly transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });

  async send(recipient: OtpRecipient, code: string, ttlSeconds: number): Promise<string> {
    if (!recipient.email) {
      throw new Error('No email address is registered for this employee code.');
    }
    const minutes = Math.round(ttlSeconds / 60);
    await this.transport.sendMail({
      from: env.SMTP_FROM || env.SMTP_USER,
      to: recipient.email,
      subject: 'Your ACS document portal sign-in code',
      text: `Hello ${recipient.name},\n\nYour sign-in code is ${code}. It expires in ${minutes} minutes.\n\nIf you did not request this code, ignore this email.`,
    });
    return maskEmail(recipient.email);
  }
}

export function createOtpDelivery(logger: FastifyBaseLogger): OtpDelivery {
  return env.OTP_DELIVERY === 'smtp' ? new SmtpOtpDelivery() : new LogOtpDelivery(logger);
}
