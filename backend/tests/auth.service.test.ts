/// <reference types="jest" />
import { setTestEnv, connectTestDB, disconnectTestDB, clearTestDB } from './setup';
setTestEnv();

import { register, login } from '../src/services/auth.service';
import User from '../src/models/User';

jest.mock('../src/config/redis', () => ({
  cacheSet: jest.fn(),
  cacheGet: jest.fn(),
  cacheDel: jest.fn(),
  cacheAvailable: true
}));

jest.mock('../src/services/email.service', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined)
}));

describe('Auth Service', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should create a new user and return tokens', async () => {
      const result = await register('new-user@example.com', 'password123', 'New User');
      
      expect(result.user.email).toBe('new-user@example.com');
      expect(result.user.displayName).toBe('New User');
      expect(result).toHaveProperty('accessToken');
      
      const dbUser = await User.findOne({ email: 'new-user@example.com' });
      expect(dbUser).toBeDefined();
    });

    it('should throw an error if email is already in use', async () => {
      await register('duplicate@example.com', 'password123', 'User 1');
      
      await expect(register('duplicate@example.com', 'password456', 'User 2'))
        .rejects.toThrow(/Email already registered/);
    });
  });

  describe('login', () => {
    it('should authenticate user and return tokens', async () => {
      await register('login@example.com', 'mypassword', 'Login User');
      
      const result = await login('login@example.com', 'mypassword');
      expect(result.user.email).toBe('login@example.com');
      expect(result).toHaveProperty('accessToken');
    });

    it('should throw error for invalid credentials', async () => {
      await register('login2@example.com', 'mypassword', 'Login User');
      
      await expect(login('login2@example.com', 'wrongpassword'))
        .rejects.toThrow(/Invalid password/);
      
      await expect(login('wrong@example.com', 'mypassword'))
        .rejects.toThrow(/No user found with email/);
    });
  });
});
