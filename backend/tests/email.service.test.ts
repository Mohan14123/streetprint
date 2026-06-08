import { sendVerificationEmail, sendPasswordResetEmail } from '../src/services/email.service';
import { env } from '../src/config/env';
import logger from '../src/config/logger';

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe('Email Service', () => {
  const originalEnv = { ...env };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
  });

  it('should use dev fallback when RESEND_API_KEY is not set', async () => {
    env.RESEND_API_KEY = '';
    const result = await sendVerificationEmail('test@example.com', 'token123');
    expect(result).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('EMAIL (dev mode'),
      expect.any(Object)
    );
  });

  it('should use Resend when RESEND_API_KEY is set', async () => {
    env.RESEND_API_KEY = 're_12345';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValueOnce({ id: '123' })
    });

    const result = await sendPasswordResetEmail('test@example.com', 'token123');
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Email sent via Resend'),
      expect.any(Object)
    );
  });

  it('should handle Resend API failure (not ok)', async () => {
    env.RESEND_API_KEY = 're_12345';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: jest.fn().mockResolvedValueOnce('Bad Request')
    });

    const result = await sendVerificationEmail('test@example.com', 'token123');
    expect(result).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Resend API error'),
      expect.any(Object)
    );
  });

  it('should handle fetch exception', async () => {
    env.RESEND_API_KEY = 're_12345';
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const result = await sendPasswordResetEmail('test@example.com', 'token123');
    expect(result).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Resend send failed'),
      expect.any(Object)
    );
  });
});
