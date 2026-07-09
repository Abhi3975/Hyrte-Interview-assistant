import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProctoringService } from './proctoring.service';
import { IngestBatchDto, IngestEventDto } from './dto/proctoring.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@ApiTags('proctoring')
@Controller('proctoring')
export class ProctoringController {
  constructor(private readonly proctoring: ProctoringService) {}

  /** Client SDK (web/Electron) posts a single signal. Auth via candidate JWT. */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles('CANDIDATE')
  @Post('events')
  ingest(@Body() dto: IngestEventDto) {
    return this.proctoring.ingest(dto);
  }

  /** High-frequency batched telemetry (mouse/typing samples etc.). */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles('CANDIDATE')
  @Post('events/batch')
  async ingestBatch(@Body() dto: IngestBatchDto) {
    const results = [];
    for (const e of dto.events) results.push(await this.proctoring.ingest(e));
    // Return only the latest aggregate to keep the response small.
    return results.at(-1) ?? { ok: true };
  }

  /**
   * Webhook for EXTERNAL proctor providers.
   *
   * Verified via HMAC-SHA256 over the raw body using PROCTOR_WEBHOOK_SECRET,
   * so a third-party vision/audio vendor (or the Electron agent backend) can
   * push events without a user JWT. No user session — trust is the signature.
   */
  @Public()
  @Post('webhook')
  async webhook(
    @Req() req: any,
    @Headers('x-proctor-signature') signature: string,
    @Body() dto: IngestEventDto,
  ) {
    const secret = process.env.PROCTOR_WEBHOOK_SECRET ?? '';
    const raw = req.rawBody ? req.rawBody.toString() : JSON.stringify(dto);
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const provided = (signature ?? '').replace(/^sha256=/, '');
    if (
      !provided ||
      provided.length !== expected.length ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    ) {
      throw new BadRequestException('Invalid webhook signature');
    }
    return this.proctoring.ingest({ ...dto, provider: dto.provider ?? 'external' });
  }

  // ── Dashboard (recruiter/admin) ──
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles('RECRUITER', 'ORG_ADMIN')
  @Get('sessions/:sessionId/timeline')
  timeline(@Param('sessionId') sessionId: string) {
    return this.proctoring.sessionTimeline(sessionId);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles('RECRUITER', 'ORG_ADMIN')
  @Get('live')
  live(@CurrentUser() user: AuthenticatedUser) {
    return this.proctoring.liveSessions(user.organizationId!);
  }
}
