import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor() {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379;

    this.client = new Redis({
      host,
      port,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => {
        if (times > 2) {
          // Stop retrying if Redis is not running
          return null;
        }
        return Math.min(times * 1000, 2000);
      },
    });

    this.client.on('error', (err: Error) => {
      this.logger.warn(`Redis unavailable (${err.message}) - caching/token-blacklist operates in degraded mode`);
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      if (this.client.status === 'wait') {
        await this.client.connect();
        this.logger.log('Connected to Redis successfully');
      }
    } catch {
      this.logger.warn('Redis is not reachable at startup; offline bypass enabled');
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.client.status === 'ready' || this.client.status === 'connecting') {
        await this.client.quit();
        this.logger.log('Disconnected from Redis');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error disconnecting from Redis: ${message}`);
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (this.client.status !== 'ready') return;
      if (ttlSeconds !== undefined && ttlSeconds > 0) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis set failed: ${message}`);
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      if (this.client.status !== 'ready') return null;
      return await this.client.get(key);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis get failed: ${message}`);
      return null;
    }
  }

  async del(key: string): Promise<number> {
    try {
      if (this.client.status !== 'ready') return 0;
      return await this.client.del(key);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis del failed: ${message}`);
      return 0;
    }
  }

  async blacklistToken(token: string, ttlSeconds: number): Promise<void> {
    const key = `blacklist:${token}`;
    await this.set(key, '1', ttlSeconds);
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      if (this.client.status !== 'ready') return false;
      const key = `blacklist:${token}`;
      const value = await this.get(key);
      return value !== null;
    } catch {
      return false;
    }
  }

  getClient(): Redis {
    return this.client;
  }
}
