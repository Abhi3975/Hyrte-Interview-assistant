import { Global, Logger, Module } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => {
        const logger = new Logger('Redis');
        // Redis is optional: when it isn't reachable we stop retrying and log
        // once, instead of spamming connection errors every second. Features
        // that use it (caching, rate-limit counters) degrade gracefully.
        const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
          lazyConnect: false,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => (times > 3 ? null : Math.min(times * 300, 1500)),
        });
        let warned = false;
        client.on('error', (err) => {
          if (!warned) {
            warned = true;
            logger.warn(`Redis unavailable — running without it (${err.message}). Set REDIS_URL to enable caching/queues.`);
          }
        });
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
