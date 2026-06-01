/**
 * src/config/logger.ts
 * Winston logger setup.
 * Rule 9.1: Structured JSON logs in production.
 * Rule 9.2: Every entry includes level, message, timestamp, service.
 * Rule 9.3: console.log / console.error forbidden — use this logger everywhere.
 */
import winston from 'winston';
import { env } from './env';

const { combine, timestamp, json, colorize, printf, errors } = winston.format;

/** Human-readable format for development */
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} [${level}] ${message}${stack ? `\n${stack}` : ''}${metaStr}`;
  }),
);

/** Structured JSON format for production */
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json(),
);

const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  defaultMeta: { service: 'route-memory' },
  format: env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
  ],
  exitOnError: false,
});

export default logger;
