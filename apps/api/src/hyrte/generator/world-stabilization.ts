import { FixtureDepartment, FixtureStakeholder, HyrteFixture } from '../fixtures/hyrte-fixture.types';
import { COMPANY_STATE_KEYS } from '../consequences/consequence.service';
import { WorldGenerationArtifact } from './simulation-generator.service';

/**
 * Upgrade §2 — the World Stabilization Gate. Real code assertions, not an
 * LLM opinion, run over the fully-assembled fixture + the raw (pre-
 * sanitization) per-step artifacts. A world that fails is never shown to the
 * candidate — see HyrteSimulationGeneratorService's repair loop and
 * WorldStabilizationError.
 */

export interface ValidationCheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ValidationReport {
  passed: boolean;
  attempt: number;
  checks: ValidationCheckResult[];
}

const STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'will', 'your', 'their', 'about', 'while', 'these', 'those',
  'been', 'were', 'they', 'them', 'over', 'into', 'more', 'also', 'than', 'when', 'what', 'which',
]);

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4 && !STOPWORDS.has(w)),
  );
}

/** Every stakeholder has non-empty goals + a hidden intention + a department — the generateable analog of "goals, memory, relationships, emotional state" pre-entry (memory/relationships only accumulate once play starts). */
function checkStakeholders(stakeholders: FixtureStakeholder[]): ValidationCheckResult {
  const bad = stakeholders.filter((s) => {
    const goals = (s.personality as { goals?: unknown })?.goals;
    return !s.department || !s.hiddenIntention || !Array.isArray(goals) || goals.length === 0;
  });
  return {
    name: 'stakeholders_have_goals_and_intentions',
    passed: bad.length === 0,
    detail:
      bad.length === 0
        ? `All ${stakeholders.length} stakeholders have a department, goals, and a hidden intention.`
        : `${bad.length}/${stakeholders.length} stakeholders missing department/goals/hiddenIntention: ${bad.map((s) => s.name).join(', ')}.`,
  };
}

/** Every department has at least one active work item (a stakeholder assigned to it with a current task). */
function checkDepartmentsHaveWork(departments: FixtureDepartment[], stakeholders: FixtureStakeholder[]): ValidationCheckResult {
  const idle = departments.filter((d) => {
    const inDept = stakeholders.filter((s) => s.department === d.name);
    return inDept.length === 0 || !inDept.some((s) => (s.currentTasks?.length ?? 0) > 0);
  });
  return {
    name: 'departments_have_active_work',
    passed: idle.length === 0,
    detail:
      idle.length === 0
        ? `All ${departments.length} departments have a staffed stakeholder with an active task.`
        : `${idle.length}/${departments.length} departments have no staffed stakeholder with an active task: ${idle.map((d) => d.name).join(', ')}.`,
  };
}

/** Company KPIs in range + mission brief non-empty (structural — always true post-sanitize, asserted as a real invariant, not assumed) + the crisis is actually referenced by generated content, not free-floating. */
function checkCompanyContext(fixture: HyrteFixture): ValidationCheckResult {
  const outOfRange = COMPANY_STATE_KEYS.filter((k) => {
    const v = fixture.companyState[k];
    return typeof v !== 'number' || v < 0 || v > 100;
  });
  const briefEmpty = !fixture.missionBrief.objective?.trim() || !fixture.missionBrief.currentHealth?.trim();
  if (outOfRange.length > 0 || briefEmpty) {
    return {
      name: 'company_context_coherent',
      passed: false,
      detail: outOfRange.length > 0 ? `Company state fields out of [0,100]: ${outOfRange.join(', ')}.` : 'Mission brief objective/currentHealth empty.',
    };
  }

  // The crisis (mission brief) must be referenced by at least 1 generated
  // asset — a weak, honest heuristic (keyword overlap, not semantic
  // understanding). Calibrated against real generation output: the mission
  // brief and workplace assets come from separate, independent LLM calls
  // (Steps 2 and 5) with no shared vocabulary forced between them, so even a
  // genuinely coherent world can legitimately share very few literal words —
  // requiring ≥2 caused real false-positive gate failures (verified live),
  // costing a full extra repair-loop attempt for no real quality signal.
  // Pulling in successMetrics (concrete nouns like "churn", "onboarding")
  // alongside objective/currentHealth widens the vocabulary pool to match
  // against, which does more to fix false positives than lowering the bar
  // alone would.
  const crisisWords = new Set([
    ...significantWords(fixture.missionBrief.objective),
    ...significantWords(fixture.missionBrief.currentHealth),
    ...fixture.missionBrief.successMetrics.flatMap((m) => [...significantWords(m)]),
  ]);
  const assetTexts = [
    ...fixture.inbox.map((m) => `${m.subject} ${m.body}`),
    ...fixture.slack.map((m) => m.body),
    ...fixture.tasks.map((t) => t.title),
  ];
  const referencing = assetTexts.filter((text) => {
    const words = significantWords(text);
    for (const w of words) if (crisisWords.has(w)) return true;
    return false;
  });
  return {
    name: 'company_context_coherent',
    passed: referencing.length >= 1,
    detail:
      referencing.length >= 1
        ? `${referencing.length} generated assets share vocabulary with the mission brief's crisis.`
        : `0 generated assets reference the mission brief's crisis — keyword-overlap heuristic, not semantic.`,
  };
}

/** No orphan stakeholder references in the RAW (pre-repair) LLM output — measures what the model actually produced, not what the sanitizer silently fixed. */
function checkNoOrphanReferences(artifacts: WorldGenerationArtifact[], validKeys: Set<string>): ValidationCheckResult {
  let total = 0;
  let dangling = 0;
  for (const a of artifacts) {
    if (a.step === 'workplace_assets') {
      const p = a.payload as { inbox?: { fromKey?: unknown }[]; slack?: { fromKey?: unknown }[] };
      for (const m of [...(p.inbox ?? []), ...(p.slack ?? [])]) {
        total++;
        if (typeof m.fromKey !== 'string' || !validKeys.has(m.fromKey)) dangling++;
      }
    }
    if (a.step === 'event_queue') {
      const p = a.payload as { scheduledEvents?: { fromKey?: unknown }[] };
      for (const e of p.scheduledEvents ?? []) {
        total++;
        if (typeof e.fromKey !== 'string' || !validKeys.has(e.fromKey)) dangling++;
      }
    }
  }
  const rate = total === 0 ? 0 : dangling / total;
  return {
    name: 'no_orphan_references',
    passed: rate < 0.5,
    detail: total === 0 ? 'No inbox/Slack/event references to check.' : `${dangling}/${total} stakeholder references were dangling in the raw model output (${Math.round(rate * 100)}%).`,
  };
}

/** Event queue internally consistent: in-range offsets, non-empty content, resolves to a real (sanitized) stakeholder. */
function checkEventQueue(fixture: HyrteFixture, stakeholderKeys: Set<string>): ValidationCheckResult {
  const bad = fixture.scheduledEvents.filter(
    (e) => !e.body?.trim() || e.fireAtOffsetSeconds < 10 || e.fireAtOffsetSeconds > 120 || !stakeholderKeys.has(e.fromKey),
  );
  return {
    name: 'event_queue_consistent',
    passed: bad.length === 0,
    detail: bad.length === 0 ? `All ${fixture.scheduledEvents.length} scheduled events are in-range and reference a real stakeholder.` : `${bad.length}/${fixture.scheduledEvents.length} scheduled events are inconsistent.`,
  };
}

export function validateWorld(fixture: HyrteFixture, artifacts: WorldGenerationArtifact[], attempt: number): ValidationReport {
  const stakeholderKeys = new Set(fixture.stakeholders.map((s) => s.key));
  const checks = [
    checkStakeholders(fixture.stakeholders),
    checkDepartmentsHaveWork(fixture.departments, fixture.stakeholders),
    checkCompanyContext(fixture),
    checkNoOrphanReferences(artifacts, stakeholderKeys),
    checkEventQueue(fixture, stakeholderKeys),
  ];
  return { passed: checks.every((c) => c.passed), attempt, checks };
}

export class WorldStabilizationError extends Error {
  constructor(public readonly report: ValidationReport) {
    super(`World failed stabilization after ${report.attempt} attempt(s): ${report.checks.filter((c) => !c.passed).map((c) => c.name).join(', ')}`);
  }
}
