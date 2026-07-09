import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AIService } from '../ai/ai.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', uptime: process.uptime(), ts: new Date().toISOString() };
  }

  /** Readiness probe — checks the DB is reachable. Used by K8s. */
  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ready',
        db: 'up',
        aiProviders: this.ai.availableProviders(),
      };
    } catch {
      return { status: 'degraded', db: 'down' };
    }
  }
}
