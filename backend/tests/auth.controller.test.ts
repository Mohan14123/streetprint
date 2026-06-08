import { register, login, refreshToken, verifyEmail, resendVerification, resetPassword } from '../src/controllers/auth.controller';
import * as authService from '../src/services/auth.service';
import { Request, Response } from 'express';

jest.mock('../src/services/auth.service');
jest.mock('../src/config/logger', () => ({ error: jest.fn(), info: jest.fn() }));

describe('Auth Controller - Error Catch Blocks', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRes = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe('register', () => {
    it('should handle AUTH_EMAIL_TAKEN', async () => {
      mockReq = { body: { email: 'test@example.com', password: 'password123', displayName: 'Test' } };
      const err: any = new Error('Email taken');
      err.code = 'AUTH_EMAIL_TAKEN';
      (authService.register as jest.Mock).mockRejectedValueOnce(err);

      register(mockReq as Request, mockRes as Response, mockNext);
      await new Promise(process.nextTick);
      expect(mockRes.status).toHaveBeenCalledWith(409);
    });

    it('should handle mongo 11000 duplicate key error', async () => {
      mockReq = { body: { email: 'test@example.com', password: 'password123', displayName: 'Test' } };
      const err: any = new Error('Duplicate key');
      err.code = 11000;
      (authService.register as jest.Mock).mockRejectedValueOnce(err);

      register(mockReq as Request, mockRes as Response, mockNext);
      await new Promise(process.nextTick);
      expect(mockRes.status).toHaveBeenCalledWith(409);
    });

    it('should throw other errors', async () => {
      mockReq = { body: { email: 'test@example.com', password: 'password123', displayName: 'Test' } };
      const err = new Error('Unknown error');
      (authService.register as jest.Mock).mockRejectedValueOnce(err);

      register(mockReq as Request, mockRes as Response, mockNext);
      await new Promise(process.nextTick);
      expect(mockNext).toHaveBeenCalledWith(err);
    });
  });

  describe('login', () => {
    it('should handle AUTH_CREDENTIALS_INVALID', async () => {
      mockReq = { body: { email: 'test@example.com', password: 'password123' } };
      const err: any = new Error('Invalid credentials');
      err.code = 'AUTH_CREDENTIALS_INVALID';
      (authService.login as jest.Mock).mockRejectedValueOnce(err);

      login(mockReq as Request, mockRes as Response, mockNext);
      await new Promise(process.nextTick);
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should throw other errors', async () => {
      mockReq = { body: { email: 'test@example.com', password: 'password123' } };
      const err = new Error('Unknown error');
      (authService.login as jest.Mock).mockRejectedValueOnce(err);

      login(mockReq as Request, mockRes as Response, mockNext);
      await new Promise(process.nextTick);
      expect(mockNext).toHaveBeenCalledWith(err);
    });
  });

  describe('refreshToken', () => {
    it('should throw other errors', async () => {
      mockReq = { body: { refreshToken: 'token123' } };
      const err = new Error('Unknown error');
      (authService.refreshAccessToken as jest.Mock).mockRejectedValueOnce(err);

      refreshToken(mockReq as Request, mockRes as Response, mockNext);
      await new Promise(process.nextTick);
      expect(mockNext).toHaveBeenCalledWith(err);
    });
  });

  describe('verifyEmail', () => {
    it('should throw other errors', async () => {
      mockReq = { query: { token: 'token123' } };
      const err = new Error('Unknown error');
      (authService.verifyEmail as jest.Mock).mockRejectedValueOnce(err);

      verifyEmail(mockReq as Request, mockRes as Response, mockNext);
      await new Promise(process.nextTick);
      expect(mockNext).toHaveBeenCalledWith(err);
    });
  });

  describe('resendVerification', () => {
    it('should throw other errors', async () => {
      mockReq = { user: { userId: 'user123' } } as any;
      const err = new Error('Unknown error');
      (authService.resendVerification as jest.Mock).mockRejectedValueOnce(err);

      resendVerification(mockReq as Request, mockRes as Response, mockNext);
      await new Promise(process.nextTick);
      expect(mockNext).toHaveBeenCalledWith(err);
    });
  });

  describe('resetPassword', () => {
    it('should throw other errors', async () => {
      mockReq = { body: { token: 'token123', password: 'newpassword123' } };
      const err = new Error('Unknown error');
      (authService.resetPassword as jest.Mock).mockRejectedValueOnce(err);

      resetPassword(mockReq as Request, mockRes as Response, mockNext);
      await new Promise(process.nextTick);
      expect(mockNext).toHaveBeenCalledWith(err);
    });
  });
});
