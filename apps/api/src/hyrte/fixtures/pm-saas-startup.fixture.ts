/**
 * Fallback seed scenario: a Product Manager at a SaaS startup. Used when the
 * Dynamic Simulation Generator (`generator/simulation-generator.service.ts`)
 * fails or no AI provider is configured, so session creation never hard-fails.
 */
import { HyrteFixture } from './hyrte-fixture.types';

export function getPmSaasStartupFixture(): HyrteFixture {
  return {
    companyName: 'Nimbus',
    departments: [],
    scheduledEvents: [],
    companyState: {
      revenue: 62,
      customerSatisfaction: 71,
      engineeringCapacity: 58,
      technicalDebt: 64,
      teamMorale: 66,
      budget: 55,
      riskLevel: 40,
      deadlinePressure: 62,
      marketReputation: 68,
      cashRunway: 48,
      complianceRisk: 22,
      productQuality: 64,
      burnout: 38,
      hiringCapacity: 45,
      operationalRisk: 35,
      growth: 58,
    },
    missionBrief: {
      objective: 'Reduce enterprise churn to under 5% this quarter without slipping the Q3 roadmap.',
      whyItMatters:
        "Nimbus just lost two enterprise accounts to a competitor after support incidents. The board is watching " +
        'retention numbers closely ahead of the Series B raise.',
      currentHealth:
        'Revenue growth has slowed, customer satisfaction is trending down after a rocky support quarter, and ' +
        "engineering capacity is stretched between the roadmap and firefighting. Market reputation is still solid.",
      successMetrics: [
        'Enterprise churn stays under 5% this quarter',
        'Q3 roadmap ships on schedule',
        'Customer satisfaction recovers to 75+',
      ],
      manager: { name: 'Priya Raman', role: 'CEO' },
    },
    baselineChallenge: {
      scenario:
        'Your team can only ship one of these next sprint: (A) a requested integration that would unblock a ' +
        "$220k/year prospect, (B) a fix for the perf regression affecting existing customers' dashboards, or " +
        '(C) the onboarding-flow redesign already promised to the board. Which do you prioritize, and why?',
      options: [
        { id: 'a', label: 'Ship the integration to close the new deal' },
        { id: 'b', label: 'Fix the perf regression for existing customers first' },
        { id: 'c', label: 'Stick to the onboarding redesign as promised' },
      ],
      roleKnowledgeQuestion: 'How would you typically decide whether a churn risk is worth an unplanned engineering sprint?',
      toolsQuestion: 'What would you look at first to figure out how bad the dashboard perf regression actually is?',
    },
    stakeholders: [
      {
        key: 'ceo',
        name: 'Priya Raman',
        role: 'CEO',
        avatarSeed: 'priya-raman',
        personality: { traits: ['decisive', 'impatient'], goals: ['hit Series B metrics'] },
        hiddenIntention: 'Privately worried the board will replace her if churn isn\'t fixed by the Q3 review — pushes hard on optics, not just substance.',
      },
      {
        key: 'eng_lead',
        name: 'Marcus Chen',
        role: 'Engineering Lead',
        avatarSeed: 'marcus-chen',
        personality: { traits: ['pragmatic', 'protective of team'], goals: ['reduce on-call load'] },
        hiddenIntention: 'Two engineers are close to burning out and he is quietly planning to slow-walk any new commitment regardless of what he agrees to out loud.',
      },
      {
        key: 'sales_lead',
        name: 'Dana Okafor',
        role: 'Head of Sales',
        avatarSeed: 'dana-okafor',
        personality: { traits: ['persuasive', 'deadline-driven'], goals: ['close Q3 enterprise deals'] },
        hiddenIntention: 'Her quota reset this quarter and she personally needs the $220k deal to hit her number, independent of what is best for the company.',
      },
      {
        key: 'support_lead',
        name: 'Ravi Patel',
        role: 'Customer Support Lead',
        avatarSeed: 'ravi-patel',
        personality: { traits: ['empathetic', 'detail-oriented'], goals: ['protect retention'] },
        hiddenIntention: 'Already promised Bramblecart a fix timeline without clearing it with Engineering first, and is hoping nobody asks.',
      },
      {
        key: 'designer',
        name: 'Lena Kowalski',
        role: 'Product Designer',
        avatarSeed: 'lena-kowalski',
        personality: { traits: ['collaborative', 'craft-focused'], goals: ['ship a coherent onboarding'] },
        hiddenIntention: 'Has been quietly job-hunting since the onboarding redesign keeps getting deprioritized and treats further delay as a signal to leave.',
      },
    ],
    inbox: [
      {
        fromKey: 'support_lead',
        subject: 'Bramblecart is threatening to churn',
        body:
          "Their VP of Ops emailed this morning saying they're evaluating a competitor after last week's outage. " +
          'This is a $180k/year account. Can we get ahead of this before their renewal call Friday?',
        urgent: true,
      },
      {
        fromKey: 'ceo',
        subject: 'Board deck — need your input by EOD',
        body:
          'Putting the board deck together for Thursday. Need your take on the Q3 roadmap slide — ' +
          'specifically what we can credibly commit to shipping this quarter.',
        urgent: false,
      },
      {
        fromKey: 'sales_lead',
        subject: 'Can we promise enterprise SSO this month?',
        body:
          "Talking to a $220k/year prospect who won't sign without SSO. Their security review is in 3 weeks. " +
          'Is this remotely feasible on the current roadmap?',
        urgent: true,
        arrivesLater: true,
      },
      {
        fromKey: 'ceo',
        subject: 'Re: Board deck — just say it\'s "on track"',
        body:
          "Quick favor — for the board slide, can we just list enterprise SSO as \"on track for this quarter\"? " +
          "I know it's not actually scoped yet, but I don't want the board second-guessing the roadmap right " +
          'before the raise. We can figure out the real timeline after.',
        urgent: false,
        arrivesLater: true,
        ethicalDilemma: true,
      },
    ],
    slack: [
      {
        channel: '#product',
        fromKey: 'designer',
        body: 'Pushed the new onboarding flow mocks to Figma — would love eyes before standup 🙏',
      },
      {
        channel: '#product',
        fromKey: 'eng_lead',
        body: "Heads up: yesterday's deploy introduced a perf regression on the dashboard, we're looking into it.",
      },
      {
        channel: 'dm:sales_lead',
        fromKey: 'sales_lead',
        body: "hey — got a sec? Bramblecart's account exec is asking if we can expedite the SSO work",
        arrivesLater: true,
      },
    ],
    tasks: [
      { title: 'Review Q3 churn deep-dive doc', priority: 'high', dueInHours: 6 },
      { title: 'Approve pricing page copy for A/B test', priority: 'medium', dueInHours: 24 },
      { title: '1:1 with Marcus re: sprint capacity', priority: 'medium', dueInHours: 30 },
    ],
    calendarEvents: [
      { title: 'Product sync', startInHours: 1, durationMins: 30 },
      { title: 'Customer escalation call — Bramblecart', startInHours: 4, durationMins: 30 },
    ],
    knowledgeDocs: [
      {
        title: 'Q3 OKRs',
        category: 'strategy',
        body:
          'O1: Reduce enterprise churn to <5%/quarter. O2: Ship self-serve onboarding v2. ' +
          'O3: Close 4 net-new enterprise logos.',
      },
      {
        title: 'Nimbus Product Principles',
        category: 'product',
        body:
          '1) Default to transparency with customers. 2) Ship small, ship often. ' +
          '3) Retention beats acquisition at our stage.',
      },
      {
        title: 'Support Escalation Runbook',
        category: 'support',
        body:
          'Tier-1 escalations (>$100k ARR at risk) page the on-call PM within 2 hours. ' +
          'Always loop in Sales before offering credits.',
      },
    ],
  };
}
