import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.platformStats();
  }

  @Get('organizations')
  orgs(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.admin.listOrganizations(num(skip), num(take, 25));
  }

  @Get('users')
  users(@Query('skip') skip?: string, @Query('take') take?: string, @Query('search') search?: string) {
    return this.admin.listUsers(num(skip), num(take, 25), search);
  }

  @Patch('users/:id/status')
  setStatus(@Param('id') id: string, @Body('status') status: 'ACTIVE' | 'SUSPENDED') {
    return this.admin.setUserStatus(id, status);
  }

  @Get('audit')
  audit(@Query('skip') skip?: string, @Query('action') action?: string) {
    return this.admin.auditLogs(num(skip), 50, action);
  }

  @Get('security')
  security(@Query('skip') skip?: string) {
    return this.admin.securityEvents(num(skip));
  }
}

function num(v: string | undefined, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
