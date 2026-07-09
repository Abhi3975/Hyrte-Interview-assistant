import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { Plan } from '@prisma/client';
import { BillingService } from './billing.service';
import { StripeClient } from './stripe.client';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

class CheckoutDto {
  @IsEnum(Plan) plan!: Plan;
  @IsOptional() @IsInt() @Min(1) seats?: number;
}

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly stripe: StripeClient,
  ) {}

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles('ORG_ADMIN')
  @Post('checkout')
  checkout(@Body() dto: CheckoutDto, @CurrentUser() user: AuthenticatedUser) {
    if (!user.organizationId) throw new BadRequestException('No organization');
    return this.billing.createCheckout({
      organizationId: user.organizationId,
      email: user.email,
      plan: dto.plan,
      seats: dto.seats ?? 1,
    });
  }

  /** Stripe webhook — public, verified via the raw body signature. */
  @Public()
  @Post('webhook')
  async webhook(@Req() req: any, @Headers('stripe-signature') signature: string) {
    const raw = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
    let event: any;
    try {
      event = this.stripe.verifyWebhook(raw, signature ?? '');
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Invalid signature');
    }
    await this.billing.handleEvent(event);
    return { received: true };
  }
}
