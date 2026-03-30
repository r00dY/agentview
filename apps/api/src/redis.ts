import Redis from 'ioredis';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not set');
}

export const REDIS_URL = process.env.REDIS_URL;
export const redisPublisher = new Redis(REDIS_URL);
