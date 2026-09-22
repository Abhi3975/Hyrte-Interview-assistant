import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Founder feedback (WhatsApp, 7 Sep): "Notification nhi ari thi na slack na
 * inbox etc — jaha bhi jo update hora tha toh pta kuch nhi chlra tha."
 *
 * Refinements doc §4: "Don't scatter information randomly across the
 * simulation. Build a unified Activity Center. Every notification has:
 * Source → Person → Context → Urgency → Action."
 *
 * The simulation already pushed websocket events for everything that happened,
 * but the frontend only used them to invalidate react-query keys — so a new
 * Slack message silently changed a list the candidate was not looking at, with
 * no badge, no bell, and no way to find out what had moved. Worse, Slack,
 * meetings and work items have no read state in the schema at all, so there was
 * nothing to compute "new since I last looked" from.
 *
 * This service is the one place that answers "what has happened that I have not
 * seen yet", across every surface, in the doc's own five-field shape.
 */

export type ActivitySource = 'INBOX' | 'SLACK' | 'MEETING' | 'REVIEW' | 'TASK';
export type ActivityUrgency = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ActivityEntry {
  id: string;
  source: ActivitySource;
  /** §4 "Person" — who this is from. Null only for genuinely system-generated items. */
  personName: string | null;
  personRole: string | null;
  /** §4 "Context" — the one line that says what this actually is. */
  title: string;
  context: string;
  urgency: ActivityUrgency;
  /** §4 "Action" — where clicking it takes you. Doc: "Clicking each should take the user directly to the relevant environment." */
  href: string;
  at: string;
  unread: boolean;
}

export interface ActivityFeed {
  entries: ActivityEntry[];
  /** Per-surface unread counts, for the sidebar badges. */
  counts: { inbox: number; slack: number; meetings: number; needsReview: number; total: number };
}

/** Surfaces that track "last seen" as a timestamp rather than per-row read state. */
const TIMESTAMP_SURFACES = ['slack', 'meetings', 'tasks'] as const;
export type TimestampSurface = (typeof TIMESTAMP_SURFACES)[number];

export function isTimestampSurface(value: string): value is TimestampSurface {
  return (TIMESTAMP_SURFACES as readonly string[]).includes(value);
}

/** A meeting this close to starting is worth surfacing as something that needs attention. */
const MEETING_SOON_MS = 30 * 60_000;

function truncate(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

@Injectable()
export class HyrteActivityService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOwnership(sessionId: string, candidateId: string) {
    const session = await this.prisma.hyrteSession.findFirst({ where: { id: sessionId, candidateId } });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  private lastSeen(session: { activityLastSeen: Prisma.JsonValue }, surface: TimestampSurface): Date | null {
    const map = (session.activityLastSeen ?? {}) as Record<string, string>;
    const raw = map[surface];
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Marks one surface as seen up to now. Called by the UI when the candidate
   * actually opens that surface — the deliberate equivalent of the inbox's
   * per-message readAt for surfaces that have no per-row read state.
   */
  async markSeen(sessionId: string, candidateId: string, surface: TimestampSurface): Promise<{ surface: TimestampSurface; at: string }> {
    const session = await this.assertOwnership(sessionId, candidateId);
    const map = { ...((session.activityLastSeen ?? {}) as Record<string, string>), [surface]: new Date().toISOString() };
    await this.prisma.hyrteSession.update({ where: { id: sessionId }, data: { activityLastSeen: map as Prisma.InputJsonValue } });
    return { surface, at: map[surface] };
  }

  async getFeed(sessionId: string, candidateId: string, limit = 40): Promise<ActivityFeed> {
    const session = await this.assertOwnership(sessionId, candidateId);
    const base = `/hyrte/session/${sessionId}`;
    const now = Date.now();

    const [inbox, slack, meetings, reviewItems] = await Promise.all([
      this.prisma.hyrteInboxMessage.findMany({
        where: { sessionId },
        include: { fromStakeholder: { select: { name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.hyrteSlackMessage.findMany({
        // Only messages FROM the world — the candidate's own posts are not news to them.
        where: { sessionId, fromStakeholderId: { not: null } },
        include: { fromStakeholder: { select: { name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.hyrteCalendarEvent.findMany({ where: { sessionId }, orderBy: { startAt: 'asc' } }),
      this.prisma.hyrteWorkItem.findMany({
        where: { sessionId, stage: 'WAITING_REVIEW', ownerIsCandidate: false },
        include: { ownerStakeholder: { select: { name: true, role: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const slackSeen = this.lastSeen(session, 'slack');
    const meetingsSeen = this.lastSeen(session, 'meetings');
    const tasksSeen = this.lastSeen(session, 'tasks');

    const entries: ActivityEntry[] = [];

    for (const m of inbox) {
      entries.push({
        id: `inbox:${m.id}`,
        source: 'INBOX',
        personName: m.fromStakeholder?.name ?? null,
        personRole: m.fromStakeholder?.role ?? null,
        title: m.subject,
        context: truncate(m.body),
        urgency: m.urgent ? 'HIGH' : 'MEDIUM',
        href: `${base}/inbox?message=${m.id}`,
        at: m.createdAt.toISOString(),
        unread: !m.readAt,
      });
    }

    for (const m of slack) {
      const isDm = m.channel.startsWith('dm:');
      entries.push({
        id: `slack:${m.id}`,
        source: 'SLACK',
        personName: m.fromStakeholder?.name ?? null,
        personRole: m.fromStakeholder?.role ?? null,
        title: isDm ? `Direct message` : m.channel,
        context: truncate(m.body),
        // A DM is addressed to the candidate personally; a channel post is not.
        urgency: isDm ? 'HIGH' : 'LOW',
        href: `${base}/slack?channel=${encodeURIComponent(m.channel)}`,
        at: m.createdAt.toISOString(),
        unread: !slackSeen || m.createdAt > slackSeen,
      });
    }

    for (const e of meetings) {
      const startsIn = e.startAt.getTime() - now;
      // Upcoming-or-just-started only — a meeting that finished an hour ago is
      // history, not something that needs attention.
      if (startsIn > MEETING_SOON_MS || e.endAt.getTime() < now) continue;
      entries.push({
        id: `meeting:${e.id}`,
        source: 'MEETING',
        personName: null,
        personRole: null,
        title: e.title,
        context: e.agenda ? truncate(e.agenda) : startsIn > 0 ? `Starts in ${Math.max(1, Math.round(startsIn / 60_000))} min` : 'In progress now',
        urgency: startsIn <= 5 * 60_000 ? 'HIGH' : 'MEDIUM',
        href: `${base}/meetings?event=${e.id}`,
        at: e.startAt.toISOString(),
        unread: !meetingsSeen || e.startAt > meetingsSeen,
      });
    }

    for (const item of reviewItems) {
      entries.push({
        id: `review:${item.id}`,
        source: 'REVIEW',
        personName: item.ownerStakeholder?.name ?? null,
        personRole: item.ownerStakeholder?.role ?? null,
        title: item.title,
        context: `${item.ownerStakeholder?.name ?? 'A colleague'} finished this and is waiting on you to approve or send it back.`,
        urgency: item.priority === 'CRITICAL' || item.priority === 'HIGH' ? 'HIGH' : 'MEDIUM',
        href: `${base}/needs-review`,
        at: item.updatedAt.toISOString(),
        unread: !tasksSeen || item.updatedAt > tasksSeen,
      });
    }

    // Unread first, then by urgency, then most recent. The point of this panel
    // is "what do I still need to deal with", not a chronological log (that is
    // the Decision Log's job) — sorting unread purely by recency put a customer
    // threatening to churn below a colleague sharing Figma mocks.
    const URGENCY_RANK: Record<ActivityUrgency, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    entries.sort((a, b) => {
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
      if (a.urgency !== b.urgency) return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      return new Date(b.at).getTime() - new Date(a.at).getTime();
    });

    const counts = {
      inbox: entries.filter((e) => e.source === 'INBOX' && e.unread).length,
      slack: entries.filter((e) => e.source === 'SLACK' && e.unread).length,
      meetings: entries.filter((e) => e.source === 'MEETING' && e.unread).length,
      needsReview: entries.filter((e) => e.source === 'REVIEW' && e.unread).length,
      total: entries.filter((e) => e.unread).length,
    };

    return { entries: entries.slice(0, limit), counts };
  }
}
