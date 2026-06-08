/// <reference types="jest" />
import { setTestEnv } from './setup';
setTestEnv();

import { sendVerificationEmail, sendPasswordResetEmail } from '../src/services/email.service';
import logger from '../src/config/logger';

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

describe('Email Service', () => {
  const email = 'test-email@example.com';
  const token = 'fake-token-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should log verification email in dev mode', async () => {
    await sendVerificationEmail(email, token);
    
    expect(logger.info).toHaveBeenCalled();
    const callArgs = (logger.info as jest.Mock).mock.calls[0];
    expect(callArgs[0]).toMatch(/EMAIL \(dev mode/);
    expect(callArgs[1].to).toBe(email);
    expect(callArgs[1].html).toContain(token);
    expect(callArgs[1].html).toContain('Verify Email');
  });

  it('should log password reset email in dev mode', async () => {
    await sendPasswordResetEmail(email, token);
    
    expect(logger.info).toHaveBeenCalled();
    const callArgs = (logger.info as jest.Mock).mock.calls[0];
    expect(callArgs[0]).toMatch(/EMAIL \(dev mode/);
    expect(callArgs[1].to).toBe(email);
    expect(callArgs[1].html).toContain(token);
    expect(callArgs[1].html).toContain('Reset Password');
  });
});
