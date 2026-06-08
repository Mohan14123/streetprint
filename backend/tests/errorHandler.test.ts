import { Request, Response, NextFunction } from 'express';
import { globalErrorHandler } from '../src/middleware/errorHandler';
import { ErrorCode } from '../src/utils/responseHelper';
import logger from '../src/config/logger';

jest.mock('../src/config/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
}));

describe('Global Error Handler', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockReq = {
      path: '/test',
      method: 'GET',
    };
    mockRes = {
      locals: { requestId: 'test-req-123' },
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    nextFunction = jest.fn();
    jest.clearAllMocks();
  });

  it('should handle SyntaxError (JSON parse error)', () => {
    const error = new SyntaxError('Unexpected token');
    (error as any).statusCode = 400;
    (error as any).code = ErrorCode.VALIDATION_ERROR;

    globalErrorHandler(error, mockReq as Request, mockRes as Response, nextFunction);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: ErrorCode.VALIDATION_ERROR,
      }),
    }));
  });

  it('should handle JWT validation errors', () => {
    const error = new Error('invalid token');
    (error as any).statusCode = 401;
    (error as any).code = ErrorCode.AUTH_TOKEN_INVALID;

    globalErrorHandler(error, mockReq as Request, mockRes as Response, nextFunction);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: ErrorCode.AUTH_TOKEN_INVALID,
      }),
    }));
  });

  it('should handle generic errors', () => {
    const error = new Error('Something went wrong');

    globalErrorHandler(error, mockReq as Request, mockRes as Response, nextFunction);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
      }),
    }));
    expect(logger.error).toHaveBeenCalled();
  });
});
