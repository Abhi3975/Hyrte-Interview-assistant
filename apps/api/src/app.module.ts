import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { loadConfig } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuditModule } from './common/audit/audit.module';
import { AIModule } from './ai/ai.module';
import { NotificationsModule } from './notifications/notifications.module';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { QuestionsModule } from './questions/questions.module';
import { InterviewsModule } from './interviews/interviews.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { ProctoringModule } from './proctoring/proctoring.module';
import { VoiceModule } from './voice/voice.module';
import { CodingModule } from './coding/coding.module';
import { BillingModule } from './billing/billing.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AdminModule } from './admin/admin.module';
import { PracticeModule } from './practice/practice.module';
import { HyrteModule } from './hyrte/hyrte.module';
import { HealthController } from './health/health.controller';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: () => loadConfig() }),
    // Rate limiting: 120 requests / 60s per IP by default (tunable per-route).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),

    // Global infrastructure
    PrismaModule,
    RedisModule,
    AuditModule,
    AIModule,
    NotificationsModule,

    // Feature modules
    AuthModule,
    UsersModule,
    QuestionsModule,
    InterviewsModule,
    EvaluationModule,
    ProctoringModule,
    VoiceModule,
    CodingModule,
    BillingModule,
    AnalyticsModule,
    AdminModule,
    PracticeModule,
    HyrteModule,
  ],
  controllers: [HealthController],
  providers: [
    // Auth is enforced globally; opt out per-route with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Global rate limiting.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
