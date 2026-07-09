import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Plan, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { StripeClient } from './stripe.client';

// Map Stripe price IDs (env-configured in real deployments) to internal plans.
const PRICE_TO_PLAN: Record<string, Plan> = {
  price_startup: 'STARTUP',
  price_growth: 'GROWTH',
  price_enterprise: 'ENTERPRISE',
};

const PLAN_TO_PRICE: Record<Plan, string | null> = {
  FREE: null,
  STARTUP: 'price_startup',
  GROWTH: 'price_growth',
  ENTERPRISE: 'price_enterprise',
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
    private readonly audit: AuditService,
  ) {}

  async createCheckout(params: {
    organizationId: string;
    email: string;
    plan: Plan;
    seats: number;
  }): Promise<{ url: string }> {
    if (!this.stripe.isConfigured()) throw new BadRequestException('Billing is not configured');
    const priceId = PLAN_TO_PRICE[params.plan];
    if (!priceId) throw new BadRequestException('Select a paid plan');

    const web = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
    const session = await this.stripe.createCheckoutSession({
      priceId,
      quantity: Math.max(1, params.seats),
      customerEmail: params.email,
      clientReferenceId: params.organizationId,
      successUrl: `${web}/recruiter/billing?status=success`,
      cancelUrl: `${web}/recruiter/billing?status=cancelled`,
    });

    await this.audit.record({
      organizationId: params.organizationId,
      action: 'billing.checkout',
      metadata: { plan: params.plan, seats: params.seats },
    });
    return { url: session.url };
  }

  /**
   * Idempotently apply a verified Stripe webhook. Handles the subscription
   * lifecycle events we care about; unknown events are acknowledged and ignored.
   */
  async handleEvent(event: any): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        await this.upsertSubscription({
          organizationId: s.client_reference_id,
          stripeCustomerId: s.customer,
          stripeSubId: s.subscription,
          status: 'ACTIVE',
        });
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object;
        const priceId = sub.items?.data?.[0]?.price?.id;
        await this.applySubscription(sub, PRICE_TO_PLAN[priceId] ?? 'FREE');
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await this.applySubscription(sub, 'FREE', 'CANCELLED');
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        await this.markStatusBySubId(inv.subscription, 'PAST_DUE');
        break;
      }
      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }
  }

  private async upsertSubscription(data: {
    organizationId: string;
    stripeCustomerId?: string;
    stripeSubId?: string;
    status: SubscriptionStatus;
  }): Promise<void> {
    const existing = await this.prisma.subscription.findFirst({
      where: { organizationId: data.organizationId },
    });
    if (existing) {
      await this.prisma.subscription.update({
        where: { id: existing.id },
        data: { stripeCustomerId: data.stripeCustomerId, stripeSubId: data.stripeSubId, status: data.status },
      });
    } else {
      await this.prisma.subscription.create({
        data: {
          organizationId: data.organizationId,
          plan: 'STARTUP',
          status: data.status,
          stripeCustomerId: data.stripeCustomerId,
          stripeSubId: data.stripeSubId,
        },
      });
    }
  }

  private async applySubscription(sub: any, plan: Plan, status: SubscriptionStatus = 'ACTIVE'): Promise<void> {
    const record = await this.prisma.subscription.findFirst({ where: { stripeSubId: sub.id } });
    if (!record) return;
    await this.prisma.$transaction([
      this.prisma.subscription.update({
        where: { id: record.id },
        data: {
          plan,
          status,
          seats: sub.items?.data?.[0]?.quantity ?? record.seats,
          currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
        },
      }),
      this.prisma.organization.update({ where: { id: record.organizationId }, data: { plan } }),
    ]);
  }

  private async markStatusBySubId(stripeSubId: string, status: SubscriptionStatus): Promise<void> {
    const record = await this.prisma.subscription.findFirst({ where: { stripeSubId } });
    if (record) {
      await this.prisma.subscription.update({ where: { id: record.id }, data: { status } });
    }
  }
}
