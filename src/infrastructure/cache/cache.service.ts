import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

type MemoryEntry = {
  value: string;
  expiresAt: number;
};

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly memory = new Map<string, MemoryEntry>();
  private redis: Redis | null = null;

  async onModuleInit() {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
      this.logger.log('REDIS_URL is not configured. Using in-memory cache fallback.');
      return;
    }

    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

    client.on('error', (error) => {
      this.logger.warn(`Redis cache error: ${error.message}`);
    });

    try {
      await client.connect();
      this.redis = client;
      this.logger.log('Connected to Redis cache.');
    } catch (error) {
      client.disconnect();
      this.logger.warn(`Redis is unavailable. Using in-memory cache fallback. ${getErrorMessage(error)}`);
    }
  }

  async onModuleDestroy() {
    this.redis?.disconnect();
  }

  async get(key: string) {
    if (this.redis) {
      try {
        return await this.redis.get(key);
      } catch (error) {
        this.logger.warn(`Redis get failed for ${key}. ${getErrorMessage(error)}`);
      }
    }

    return this.getMemoryValue(key);
  }

  async set(key: string, value: string, ttlSeconds: number) {
    if (this.redis) {
      try {
        await this.redis.set(key, value, 'EX', ttlSeconds);
        return;
      } catch (error) {
        this.logger.warn(`Redis set failed for ${key}. ${getErrorMessage(error)}`);
      }
    }

    this.setMemoryValue(key, value, ttlSeconds);
  }

  async delete(key: string) {
    if (this.redis) {
      try {
        await this.redis.del(key);
        return;
      } catch (error) {
        this.logger.warn(`Redis delete failed for ${key}. ${getErrorMessage(error)}`);
      }
    }

    this.memory.delete(key);
  }

  async increment(key: string, ttlSeconds: number) {
    if (this.redis) {
      try {
        const count = await this.redis.incr(key);

        if (count === 1) {
          await this.redis.expire(key, ttlSeconds);
        }

        const ttl = await this.redis.ttl(key);

        return {
          count,
          ttlSeconds: ttl > 0 ? ttl : ttlSeconds,
        };
      } catch (error) {
        this.logger.warn(`Redis increment failed for ${key}. ${getErrorMessage(error)}`);
      }
    }

    return this.incrementMemoryValue(key, ttlSeconds);
  }

  private getMemoryValue(key: string) {
    const entry = this.memory.get(key);

    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }

    return entry.value;
  }

  private setMemoryValue(key: string, value: string, ttlSeconds: number) {
    this.memory.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  private incrementMemoryValue(key: string, ttlSeconds: number) {
    const now = Date.now();
    const entry = this.memory.get(key);

    if (!entry || entry.expiresAt <= now) {
      this.memory.set(key, {
        value: '1',
        expiresAt: now + ttlSeconds * 1000,
      });

      return { count: 1, ttlSeconds };
    }

    const count = Number(entry.value) + 1;
    entry.value = String(count);
    this.memory.set(key, entry);

    return {
      count,
      ttlSeconds: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)),
    };
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
