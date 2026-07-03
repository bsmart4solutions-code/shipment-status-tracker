import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import * as fs from 'fs';
import * as path from 'path';

/**
 * App-wide logger: colorized human-readable console + JSON files
 * (logs/error.log for errors, logs/combined.log for everything).
 * LOG_LEVEL env controls verbosity (default: debug in dev).
 */
export function createAppLogger() {
  const logDir = path.resolve(process.cwd(), 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, message, context, stack }) => {
      const ctx = context ? ` [${context}]` : '';
      return `${timestamp} ${level}${ctx} ${stack || message}`;
    }),
  );

  const fileFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  );

  return WinstonModule.createLogger({
    level: process.env.LOG_LEVEL || 'debug',
    transports: [
      new winston.transports.Console({ format: consoleFormat }),
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        format: fileFormat,
        maxsize: 10 * 1024 * 1024, // 10 MB, then rotate
        maxFiles: 5,
      }),
      new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        format: fileFormat,
        maxsize: 10 * 1024 * 1024,
        maxFiles: 5,
      }),
    ],
  });
}
