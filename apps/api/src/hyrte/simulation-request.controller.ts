import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SimulationRequestService } from './simulation-request.service';
import { CreateSimulationRequestDto, PreviewSimulationRequestDto } from './dto/hyrte.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

/**
 * Upgrade §1 — recruiter-owned entry point. Recruiter previews/creates
 * (JWT-gated, RECRUITER+); candidate resolves a code pre-login (same pattern
 * as the main product's `Interview` invite codes) and launches once
 * authenticated.
 */
@ApiTags('hyrte')
@ApiBearerAuth()
@Controller('hyrte/simulation-requests')
@UseGuards(RolesGuard)
export class SimulationRequestController {
  constructor(private readonly requests: SimulationRequestService) {}

  @Post('preview')
  @Roles('RECRUITER', 'ORG_ADMIN', 'SUPER_ADMIN')
  preview(@Body() dto: PreviewSimulationRequestDto) {
    return this.requests.preview(dto);
  }

  @Post()
  @Roles('RECRUITER', 'ORG_ADMIN', 'SUPER_ADMIN')
  create(@Body() dto: CreateSimulationRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requests.create(user.id, dto);
  }

  @Get('mine')
  @Roles('RECRUITER', 'ORG_ADMIN', 'SUPER_ADMIN')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.requests.listMine(user.id);
  }

  /** Candidate: resolve a simulation-request code to its preview (pre-login OK). */
  @Public()
  @Get('by-code/:code')
  getByCode(@Param('code') code: string) {
    return this.requests.getByCode(code);
  }

  @Post('by-code/:code/launch')
  @Roles('CANDIDATE')
  launch(@Param('code') code: string, @CurrentUser() user: AuthenticatedUser) {
    return this.requests.launch(code, user.id);
  }
}
