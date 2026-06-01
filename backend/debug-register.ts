/**
 * Minimal test: hit the Express app directly to get the error.
 * Run: npx ts-node-dev --transpile-only debug-register.ts
 */
import app from './src/app';
import http from 'http';
import { connectDB } from './src/config/db';
import { connectRedis } from './src/config/redis';

async function main() {
  await connectDB();
  await connectRedis();

  const server = http.createServer(app);
  server.listen(3001, async () => {
    console.log('Debug server listening on 3001');

    // Test health endpoint
    try {
      const healthRes = await fetch('http://localhost:3001/health');
      console.log('HEALTH status:', healthRes.status);
      console.log('HEALTH body:', await healthRes.text());
    } catch (e) {
      console.log('HEALTH error:', e);
    }

    // Test register endpoint
    try {
      const regRes = await fetch('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'debug@test.com',
          password: 'testpass123',
          displayName: 'Debug User',
        }),
      });
      console.log('REGISTER status:', regRes.status);
      const text = await regRes.text();
      console.log('REGISTER body:', text);
    } catch (e) {
      console.log('REGISTER error:', e);
    }

    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
