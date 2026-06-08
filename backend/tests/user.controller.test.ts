import { exportData, deleteAccount } from '../src/controllers/user.controller';
import * as userService from '../src/services/user.service';
import { Response } from 'express';

jest.mock('../src/services/user.service');

describe('User Controller - Error Catch Blocks', () => {
  let mockReq: any;
  let mockRes: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = { user: { userId: 'user123' } };
    mockRes = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe('exportData', () => {
    it('should handle AUTH_USER_NOT_FOUND', async () => {
      const err: any = new Error('User not found');
      err.code = 'AUTH_USER_NOT_FOUND';
      (userService.exportUserData as jest.Mock).mockRejectedValueOnce(err);

      exportData(mockReq, mockRes as Response, mockNext);
      await new Promise(process.nextTick);
      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should throw other errors', async () => {
      const err = new Error('Unknown error');
      (userService.exportUserData as jest.Mock).mockRejectedValueOnce(err);

      exportData(mockReq, mockRes as Response, mockNext);
      await new Promise(process.nextTick);
      expect(mockNext).toHaveBeenCalledWith(err);
    });
  });

  describe('deleteAccount', () => {
    it('should handle AUTH_USER_NOT_FOUND', async () => {
      const err: any = new Error('User not found');
      err.code = 'AUTH_USER_NOT_FOUND';
      (userService.deleteUserAccount as jest.Mock).mockRejectedValueOnce(err);

      deleteAccount(mockReq, mockRes as Response, mockNext);
      await new Promise(process.nextTick);
      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should throw other errors', async () => {
      const err = new Error('Unknown error');
      (userService.deleteUserAccount as jest.Mock).mockRejectedValueOnce(err);

      deleteAccount(mockReq, mockRes as Response, mockNext);
      await new Promise(process.nextTick);
      expect(mockNext).toHaveBeenCalledWith(err);
    });
  });
});
