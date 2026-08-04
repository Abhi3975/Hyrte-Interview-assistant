import { validateWorld } from '../src/hyrte/generator/world-stabilization';
import { WorldGenerationArtifact } from '../src/hyrte/generator/simulation-generator.service';
import { HyrteFixture } from '../src/hyrte/fixtures/hyrte-fixture.types';

function baseFixture(): HyrteFixture {
  return {
    companyName: 'TestCo',
    companyState: {
      revenue: 50, customerSatisfaction: 50, engineeringCapacity: 50, technicalDebt: 50, teamMorale: 50,
      budget: 50, riskLevel: 50, deadlinePressure: 50, marketReputation: 50, cashRunway: 50, complianceRisk: 50,
      productQuality: 50, burnout: 50, hiringCapacity: 50, operationalRisk: 50, growth: 50,
    },
    missionBrief: {
      objective: 'Reduce customer churn by improving onboarding quality',
      whyItMatters: 'Churn is hurting revenue',
      currentHealth: 'Onboarding completion rates have dropped and churn is rising sharply',
      successMetrics: ['Lower churn'],
    },
    baselineChallenge: { scenario: 'x', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], roleKnowledgeQuestion: 'q1', toolsQuestion: 'q2' },
    departments: [{ name: 'Engineering', headStakeholderKey: 'eng1' }],
    stakeholders: [
      {
        key: 'eng1', name: 'Jane', role: 'Eng Lead', avatarSeed: 'jane', department: 'Engineering',
        experienceLevel: '5 years', authorityLevel: 70, kpis: ['Uptime'], currentTasks: ['Fix onboarding bug'],
        personality: { traits: ['direct'], goals: ['ship reliably'] }, hiddenIntention: 'wants a promotion',
        stress: 50, urgency: 50, patience: 50, motivation: 50,
      },
    ],
    inbox: [{ fromKey: 'eng1', subject: 'Onboarding churn', body: 'Our onboarding completion rate keeps dropping and churn is rising, please help', urgent: true, ethicalDilemma: false }],
    slack: [{ channel: '#eng', fromKey: 'eng1', body: 'churn is bad this week', ethicalDilemma: false }],
    tasks: [{ title: 'Investigate onboarding churn', priority: 'high', dueInHours: 24 }],
    calendarEvents: [],
    knowledgeDocs: [],
    scheduledEvents: [{ surface: 'inbox', fromKey: 'eng1', subject: 'Follow-up', body: 'ping', fireAtOffsetSeconds: 30, urgent: false, ethicalDilemma: false }],
  };
}

function baseArtifacts(fixture: HyrteFixture): WorldGenerationArtifact[] {
  return [
    { step: 'workplace_assets', status: 'OK', payload: { inbox: fixture.inbox, slack: fixture.slack } },
    { step: 'event_queue', status: 'OK', payload: { scheduledEvents: fixture.scheduledEvents } },
  ];
}

describe('World Stabilization Gate (§2)', () => {
  it('passes a well-formed world', () => {
    const fixture = baseFixture();
    const report = validateWorld(fixture, baseArtifacts(fixture), 1);
    expect(report.passed).toBe(true);
    expect(report.checks.every((c) => c.passed)).toBe(true);
  });

  it('fails a stakeholder with no goals or hidden intention', () => {
    const fixture = baseFixture();
    fixture.stakeholders[0].personality = { traits: ['direct'] }; // no goals
    fixture.stakeholders[0].hiddenIntention = undefined;
    const report = validateWorld(fixture, baseArtifacts(fixture), 1);
    expect(report.passed).toBe(false);
    expect(report.checks.find((c) => c.name === 'stakeholders_have_goals_and_intentions')?.passed).toBe(false);
  });

  it('fails a department with no staffed active work item', () => {
    const fixture = baseFixture();
    fixture.departments.push({ name: 'Sales' }); // no stakeholder assigned
    const report = validateWorld(fixture, baseArtifacts(fixture), 1);
    expect(report.passed).toBe(false);
    expect(report.checks.find((c) => c.name === 'departments_have_active_work')?.passed).toBe(false);
  });

  it('fails company-state values out of range', () => {
    const fixture = baseFixture();
    (fixture.companyState as any).revenue = 150;
    const report = validateWorld(fixture, baseArtifacts(fixture), 1);
    expect(report.passed).toBe(false);
    expect(report.checks.find((c) => c.name === 'company_context_coherent')?.passed).toBe(false);
  });

  it('fails when generated assets never reference the mission-brief crisis', () => {
    const fixture = baseFixture();
    fixture.inbox = [{ fromKey: 'eng1', subject: 'Unrelated', body: 'Lunch plans for Friday', urgent: false, ethicalDilemma: false }];
    fixture.slack = [{ channel: '#eng', fromKey: 'eng1', body: 'anyone want coffee', ethicalDilemma: false }];
    fixture.tasks = [{ title: 'Order snacks', priority: 'low' }];
    const report = validateWorld(fixture, baseArtifacts(fixture), 1);
    expect(report.passed).toBe(false);
    expect(report.checks.find((c) => c.name === 'company_context_coherent')?.passed).toBe(false);
  });

  it('fails when the raw model output has dangling stakeholder references', () => {
    const fixture = baseFixture();
    // sanitized fixture looks fine (repaired), but the RAW artifact still shows the dangling key.
    const artifacts: WorldGenerationArtifact[] = [
      { step: 'workplace_assets', status: 'OK', payload: { inbox: [{ fromKey: 'ghost-key-1' }, { fromKey: 'ghost-key-2' }], slack: [] } },
      { step: 'event_queue', status: 'OK', payload: { scheduledEvents: [] } },
    ];
    const report = validateWorld(fixture, artifacts, 1);
    expect(report.passed).toBe(false);
    expect(report.checks.find((c) => c.name === 'no_orphan_references')?.passed).toBe(false);
  });

  it('fails an event queue entry with an out-of-range offset', () => {
    const fixture = baseFixture();
    fixture.scheduledEvents[0].fireAtOffsetSeconds = 999;
    const report = validateWorld(fixture, baseArtifacts(fixture), 1);
    expect(report.passed).toBe(false);
    expect(report.checks.find((c) => c.name === 'event_queue_consistent')?.passed).toBe(false);
  });
});
