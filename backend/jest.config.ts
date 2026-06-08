const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Set env vars before any src/ module is imported (env.ts Zod validation)
  setupFiles: ['<rootDir>/tests/globalSetup.ts'],
  // Increase timeout for integration tests with in-memory Mongo
  testTimeout: 30_000,
  // Run tests sequentially (shared in-memory DB)
  maxWorkers: 1,
  // Silence console output in tests
  silent: true,
  // Force exit after tests complete (cleanup handles in afterAll)
  forceExit: true,
  // Detect open handles for debugging
  detectOpenHandles: false,
};

export default config;
