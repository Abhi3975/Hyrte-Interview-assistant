/**
 * Seed script — provisions a realistic demo tenant so every dashboard,
 * analytics view, and the live proctoring board render with meaningful data.
 *
 * Creates: an org + subscription, a super-admin, a recruiter, several
 * candidates, a cross-category question bank, interviews, and sessions in a
 * mix of states — completed (with AI evaluations), active (with proctoring
 * events + risk), and awaiting approval.
 *
 * Idempotent-ish: it clears prior demo rows for the org before reseeding.
 */
import {
  Category,
  Difficulty,
  PrismaClient,
  ProctorEventType,
  ProctorSeverity,
  Recommendation,
  Role,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(arr: T[]): T => arr[rand(arr.length)];
const hash = (s: string) => createHash('sha256').update(s.toLowerCase()).digest('hex');
const publicId = (cat: string, topic: string) =>
  `${cat}-${topic.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)}-${randomUUID().slice(0, 6).toUpperCase()}`;

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-co' },
    update: {},
    create: { name: 'Demo Co', slug: 'demo-co', plan: 'GROWTH' },
  });

  // Fresh slate for the demo org so counts stay realistic across reseeds.
  await prisma.interview.deleteMany({ where: { organizationId: org.id } });
  await prisma.subscription.deleteMany({ where: { organizationId: org.id } });

  await prisma.subscription.create({
    data: {
      organizationId: org.id,
      plan: 'GROWTH',
      status: 'ACTIVE',
      seats: 10,
      currentPeriodEnd: new Date(Date.now() + 30 * 864e5),
    },
  });

  const password = await argon2.hash('Password123!');

  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@interviewai.co' },
    update: {},
    create: { email: 'admin@interviewai.co', passwordHash: password, fullName: 'Ava Admin', role: Role.SUPER_ADMIN, emailVerified: true },
  });

  const recruiter = await prisma.user.upsert({
    where: { email: 'recruiter@demo.co' },
    update: {},
    create: { email: 'recruiter@demo.co', passwordHash: password, fullName: 'Riya Recruiter', role: Role.ORG_ADMIN, organizationId: org.id, emailVerified: true },
  });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: recruiter.id, organizationId: org.id } },
    update: {},
    create: { userId: recruiter.id, organizationId: org.id, role: Role.ORG_ADMIN },
  });

  // Candidates
  const candidateSpecs = [
    { email: 'candidate@demo.co', name: 'Cavan Candidate', skills: ['React', 'Node.js', 'SQL'] },
    { email: 'neha@demo.co', name: 'Neha Sharma', skills: ['Python', 'Pandas', 'SQL'] },
    { email: 'arjun@demo.co', name: 'Arjun Rao', skills: ['Java', 'System Design', 'AWS'] },
    { email: 'mei@demo.co', name: 'Mei Lin', skills: ['TypeScript', 'Next.js', 'GraphQL'] },
    { email: 'omar@demo.co', name: 'Omar Farouk', skills: ['Go', 'Kubernetes', 'PostgreSQL'] },
  ];
  const candidates = [];
  for (const c of candidateSpecs) {
    const u = await prisma.user.upsert({
      where: { email: c.email },
      update: {},
      create: {
        email: c.email,
        passwordHash: password,
        fullName: c.name,
        role: Role.CANDIDATE,
        emailVerified: true,
        candidateProfile: { create: { skills: c.skills, headline: `${c.skills[0]} engineer` } },
      },
    });
    candidates.push(u);
  }

  // Question bank across categories
  const qSpecs: { title: string; prompt: string; category: Category; topic: string; difficulty: Difficulty }[] = [
    { title: 'Two Sum', prompt: 'Return indices of two numbers that add up to a target.', category: 'DSA', topic: 'Arrays', difficulty: 'EASY' },
    { title: 'Valid Parentheses', prompt: 'Determine if the input string of brackets is valid.', category: 'DSA', topic: 'Stacks', difficulty: 'EASY' },
    { title: 'LRU Cache', prompt: 'Design and implement an LRU cache with O(1) operations.', category: 'DSA', topic: 'Design', difficulty: 'MEDIUM' },
    { title: 'React reconciliation', prompt: 'Explain how React reconciles the virtual DOM on state change.', category: 'FRONTEND', topic: 'React', difficulty: 'MEDIUM' },
    { title: 'Event loop', prompt: 'Explain the Node.js event loop and microtask queue.', category: 'BACKEND', topic: 'Node.js', difficulty: 'MEDIUM' },
    { title: 'Index selection', prompt: 'When would a composite index outperform two single-column indexes?', category: 'DATABASE', topic: 'Indexing', difficulty: 'HARD' },
    { title: 'Design a URL shortener', prompt: 'Design a scalable URL shortener: data model, hashing, caching.', category: 'SYSTEM_DESIGN', topic: 'System Design', difficulty: 'HARD' },
    { title: 'Cohort retention', prompt: 'Write SQL to compute weekly cohort retention from an events table.', category: 'DATA_ANALYTICS', topic: 'SQL Analytics', difficulty: 'MEDIUM' },
    { title: 'Go-to-market', prompt: 'How would you price and launch a new B2B analytics product?', category: 'PRODUCT_MANAGEMENT', topic: 'GTM', difficulty: 'MEDIUM' },
    { title: 'Conflict resolution', prompt: 'Tell me about a time you resolved conflict within a team.', category: 'HR', topic: 'Behavioral', difficulty: 'EASY' },
    // AI/ML round
    { title: 'Bias–variance tradeoff', prompt: 'Explain the bias–variance tradeoff and how it guides model selection.', category: 'AI_ML', topic: 'ML Theory', difficulty: 'MEDIUM' },
    { title: 'Overfitting remedies', prompt: 'A model has 99% train accuracy but 70% validation accuracy. What is happening and how would you fix it?', category: 'AI_ML', topic: 'Regularization', difficulty: 'MEDIUM' },
    { title: 'Transformer attention', prompt: 'Explain self-attention in transformers and why it scales quadratically with sequence length.', category: 'AI_ML', topic: 'Deep Learning', difficulty: 'HARD' },
    { title: 'Deploy an ML model', prompt: 'Design a system to serve a real-time recommendation model at 10k QPS with sub-100ms latency.', category: 'AI_ML', topic: 'MLOps', difficulty: 'HARD' },
    // Finance round
    { title: 'DCF valuation', prompt: 'Walk me through a discounted cash flow valuation and its key assumptions.', category: 'FINANCE', topic: 'Valuation', difficulty: 'MEDIUM' },
    { title: 'Three financial statements', prompt: 'How do the income statement, balance sheet, and cash flow statement link together?', category: 'FINANCE', topic: 'Accounting', difficulty: 'MEDIUM' },
    { title: 'WACC', prompt: 'Explain the weighted average cost of capital and how you would compute it for a public company.', category: 'FINANCE', topic: 'Corporate Finance', difficulty: 'HARD' },
    { title: 'Unit economics', prompt: 'A SaaS startup has CAC of $1,200 and monthly churn of 4%. Assess its unit economics.', category: 'FINANCE', topic: 'FP&A', difficulty: 'MEDIUM' },
  ];
  const questions = [];
  for (const q of qSpecs) {
    const license = await prisma.license.create({ data: { type: 'AI_GENERATED', sourceName: 'Seed sample' } });
    const created = await prisma.question.create({
      data: {
        publicId: publicId(q.category, q.topic),
        title: q.title,
        prompt: q.prompt,
        category: q.category,
        topic: q.topic,
        difficulty: q.difficulty,
        type: q.category === 'DSA' ? 'CODING' : q.category === 'SYSTEM_DESIGN' ? 'SYSTEM_DESIGN' : q.category === 'HR' ? 'BEHAVIORAL' : 'SHORT_ANSWER',
        source: 'AI_GENERATED',
        licenseId: license.id,
        contentHash: hash(q.prompt),
        moderation: 'AUTO_APPROVED',
        rubric: [
          { criterion: 'Correctness', weight: 40 },
          { criterion: 'Clarity', weight: 30 },
          { criterion: 'Depth', weight: 30 },
        ],
        followUps: ['Can you elaborate on the trade-offs?', 'How does this scale under load?'],
      },
    });
    questions.push(created);
  }

  // Interviews
  const interviewSpecs: { title: string; role: string; category: Category; difficulty: Difficulty }[] = [
    { title: 'Backend Engineer — Round 1', role: 'Senior Backend Engineer', category: 'BACKEND', difficulty: 'MEDIUM' },
    { title: 'Frontend Engineer — Screen', role: 'Frontend Engineer', category: 'FRONTEND', difficulty: 'MEDIUM' },
    { title: 'DSA Assessment', role: 'Software Engineer', category: 'DSA', difficulty: 'HARD' },
    { title: 'AI/ML Engineer — Technical', role: 'Machine Learning Engineer', category: 'AI_ML', difficulty: 'HARD' },
    { title: 'Finance Analyst — Technical', role: 'Financial Analyst', category: 'FINANCE', difficulty: 'MEDIUM' },
  ];

  const competencyKeys = ['communication', 'technicalAccuracy', 'confidence', 'problemSolving', 'leadership', 'behavioral'];
  const recs: Recommendation[] = ['STRONG_HIRE', 'HIRE', 'LEAN_HIRE', 'NO_HIRE'];

  for (const spec of interviewSpecs) {
    const interview = await prisma.interview.create({
      data: {
        organizationId: org.id,
        title: spec.title,
        jobRole: spec.role,
        category: spec.category,
        difficulty: spec.difficulty,
        mode: 'MIXED',
        status: 'SCHEDULED',
        createdById: recruiter.id,
      },
    });

    // Attach 3 relevant questions.
    const relevant = questions.filter((q) => q.category === spec.category).slice(0, 3);
    const pool = relevant.length ? relevant : questions.slice(0, 3);
    await prisma.interviewQuestion.createMany({
      data: pool.map((q, i) => ({ interviewId: interview.id, questionId: q.id, ordinal: i })),
      skipDuplicates: true,
    });

    // Create sessions for a few candidates in varied states.
    for (const candidate of candidates.slice(0, 4)) {
      const roll = Math.random();
      if (roll < 0.55) {
        // Completed with an AI evaluation.
        const session = await prisma.interviewSession.create({
          data: {
            interviewId: interview.id,
            candidateId: candidate.id,
            examState: 'COMPLETED',
            status: 'COMPLETED',
            identityVerified: true,
            startedAt: new Date(Date.now() - 3 * 864e5),
            completedAt: new Date(Date.now() - 3 * 864e5 + 45 * 6e4),
          },
        });
        const overall = 45 + rand(50);
        const competencies: Record<string, number> = {};
        for (const k of competencyKeys) competencies[k] = Math.max(30, Math.min(98, overall + rand(20) - 10));
        await prisma.evaluation.create({
          data: {
            sessionId: session.id,
            overallScore: overall,
            competencies,
            strengths: ['Clear communication', 'Solid fundamentals'],
            weaknesses: overall < 65 ? ['Struggled with scaling questions'] : [],
            summary: `Candidate scored ${overall}/100 overall.`,
            recommendation: overall >= 80 ? 'STRONG_HIRE' : overall >= 65 ? 'HIRE' : overall >= 55 ? 'LEAN_HIRE' : 'NO_HIRE',
            modelMeta: { providers: ['seed'] },
          },
        });
      } else if (roll < 0.8) {
        // Active session with live proctoring signals + risk.
        const session = await prisma.interviewSession.create({
          data: {
            interviewId: interview.id,
            candidateId: candidate.id,
            examState: 'ACTIVE',
            status: 'IN_PROGRESS',
            identityVerified: true,
            startedAt: new Date(Date.now() - 10 * 6e4),
            riskScore: 0,
          },
        });
        await seedProctoring(session.id, org.id);
      } else {
        // Awaiting admin approval.
        await prisma.interviewSession.create({
          data: {
            interviewId: interview.id,
            candidateId: candidate.id,
            examState: 'WAITING_APPROVAL',
            status: 'SCHEDULED',
          },
        });
      }
    }
  }

  console.log('✔ Seed complete.');
  console.log('  Super admin: admin@interviewai.co');
  console.log('  Recruiter:   recruiter@demo.co');
  console.log('  Candidates:  candidate@demo.co (+ neha/arjun/mei/omar @demo.co)');
  console.log('  Password:    Password123!');
}

/** Seed a spread of proctoring events + a risk assessment for a live session. */
async function seedProctoring(sessionId: string, organizationId: string) {
  const events: { type: ProctorEventType; severity: ProctorSeverity }[] = [
    { type: 'TAB_SWITCH', severity: 'MEDIUM' },
    { type: 'TAB_SWITCH', severity: 'MEDIUM' },
    { type: 'LOOKING_AWAY', severity: 'LOW' },
    { type: 'FACE_NOT_DETECTED', severity: 'LOW' },
    { type: pick(['OBJECT_PHONE', 'MULTIPLE_FACES', 'WINDOW_BLUR']) as ProctorEventType, severity: 'HIGH' },
  ];
  for (let i = 0; i < events.length; i++) {
    await prisma.proctorEvent.create({
      data: {
        sessionId,
        type: events[i].type,
        severity: events[i].severity,
        provider: pick(['internal', 'inference-service', 'desktop-agent']),
        occurredAt: new Date(Date.now() - (events.length - i) * 6e4),
      },
    });
  }
  const riskScore = 30 + rand(45);
  await prisma.riskAssessment.create({
    data: {
      sessionId,
      riskScore,
      cheatingProbability: Math.round((riskScore / 100) * 100) / 100,
      confidenceScore: 0.6,
      breakdown: { screen: 12, vision: 8, object: 18 },
      topSignals: ['TAB_SWITCH', 'OBJECT_PHONE'],
    },
  });
  await prisma.interviewSession.update({ where: { id: sessionId }, data: { riskScore } });

  // If risk is high, add a warning (kept below 3 so the session stays active).
  if (riskScore >= 40) {
    await prisma.warning.create({
      data: { sessionId, level: 1, triggerType: 'TAB_SWITCH', riskScoreAt: riskScore, metadata: {} },
    });
    await prisma.interviewSession.update({ where: { id: sessionId }, data: { warningCount: 1, examState: 'WARNING_ISSUED' } });
  }

  // Audit trail entry so the security center has content.
  await prisma.auditLog.create({
    data: { organizationId, action: 'proctoring.warning.level_1', targetType: 'InterviewSession', targetId: sessionId, metadata: { risk: riskScore } },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
