import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CodingService } from './coding.service';
import { RunCodeDto } from './dto/coding.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@ApiTags('coding')
@ApiBearerAuth()
@Controller('coding')
@UseGuards(RolesGuard)
export class CodingController {
  constructor(private readonly coding: CodingService) {}

  /** Run against sample cases (submit=false) or submit & grade (submit=true). */
  @Post('run')
  @Roles('CANDIDATE')
  run(@Body() dto: RunCodeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.coding.runOrSubmit({
      sessionId: dto.sessionId,
      questionId: dto.questionId,
      language: dto.language,
      code: dto.code,
      submit: Boolean(dto.submit),
      candidateId: user.id,
    });
  }
}
