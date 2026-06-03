/**
 * src/services/email.service.ts
 * Email delivery — uses Resend when API key is configured, otherwise
 * logs email content via Winston (dev mode).
 *
 * Rule 9.2: All logs structured JSON. Never log passwords/tokens in production.
 * Rule 10.3: All config from env.ts.
 */
import { env } from '../config/env';
import logger from '../config/logger';

// ────────────────────────────────────────────────────────────────
// Transport abstraction
// ────────────────────────────────────────────────────────────────

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

async function sendViaResend(payload: EmailPayload): Promise<boolean> {
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.SMTP_FROM,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      logger.error('[email.service] Resend API error', {
        status: resp.status,
        body,
      });
      return false;
    }

    logger.info('[email.service] Email sent via Resend', {
      to: payload.to,
      subject: payload.subject,
    });
    return true;
  } catch (err) {
    logger.error('[email.service] Resend send failed', { error: err });
    return false;
  }
}

function logToConsole(payload: EmailPayload): boolean {
  logger.info('[email.service] EMAIL (dev mode — no transport configured)', {
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  });
  return true;
}

async function sendEmail(payload: EmailPayload): Promise<boolean> {
  if (env.RESEND_API_KEY) {
    return sendViaResend(payload);
  }
  // Dev fallback — log the email
  return logToConsole(payload);
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Send email verification link to user.
 */
export async function sendVerificationEmail(
  email: string,
  token: string,
): Promise<boolean> {
  const verifyUrl = `${env.APP_URL}/verify-email?token=${token}`;

  return sendEmail({
    to: email,
    subject: 'Verify your StreetPrint email',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; background: #0D1117; color: #e2e8f0; padding: 40px 24px; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-block; width: 48px; height: 48px; background: linear-gradient(135deg, #06b6d4, #2563eb); border-radius: 12px; line-height: 48px; font-size: 24px;">📍</div>
          <h1 style="font-size: 24px; margin: 16px 0 4px; color: #fff;">StreetPrint</h1>
          <p style="color: #64748b; font-size: 14px; margin: 0;">Verify your email address</p>
        </div>
        <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">Click the button below to verify your email and start exploring:</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${verifyUrl}" style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #06b6d4, #2563eb); color: #fff; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 14px;">Verify Email</a>
        </div>
        <p style="color: #64748b; font-size: 12px; text-align: center;">This link expires in ${env.EMAIL_VERIFICATION_EXPIRY_HOURS} hours.</p>
        <p style="color: #475569; font-size: 11px; text-align: center; margin-top: 24px;">If you didn't create a StreetPrint account, you can ignore this email.</p>
      </div>
    `,
  });
}

/**
 * Send password reset link to user.
 */
export async function sendPasswordResetEmail(
  email: string,
  token: string,
): Promise<boolean> {
  const resetUrl = `${env.APP_URL}/reset-password?token=${token}`;

  return sendEmail({
    to: email,
    subject: 'Reset your StreetPrint password',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; background: #0D1117; color: #e2e8f0; padding: 40px 24px; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-block; width: 48px; height: 48px; background: linear-gradient(135deg, #06b6d4, #2563eb); border-radius: 12px; line-height: 48px; font-size: 24px;">📍</div>
          <h1 style="font-size: 24px; margin: 16px 0 4px; color: #fff;">StreetPrint</h1>
          <p style="color: #64748b; font-size: 14px; margin: 0;">Password Reset</p>
        </div>
        <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">Click the button below to reset your password:</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${resetUrl}" style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #06b6d4, #2563eb); color: #fff; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 14px;">Reset Password</a>
        </div>
        <p style="color: #64748b; font-size: 12px; text-align: center;">This link expires in ${env.PASSWORD_RESET_EXPIRY_MINUTES} minutes.</p>
        <p style="color: #475569; font-size: 11px; text-align: center; margin-top: 24px;">If you didn't request a password reset, you can ignore this email.</p>
      </div>
    `,
  });
}
