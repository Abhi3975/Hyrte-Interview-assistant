import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { StripeClient } from './stripe.client';

@Module({
  controllers: [BillingController],
  providers: [BillingService, StripeClient],
  exports: [BillingService],
})
export class BillingModule {}
