import { findRoleTask, resolveRoleTasks } from '../src/hyrte/generator/role-tasks';
import { buildAttendeeCard, buildRealityLayerDirective, formatCandidateRecord, formatPriorStatements } from '../src/hyrte/meetings/meeting-context';

/**
 * Refinements doc §10/§11 (Hero Tasks — "they need to do the work") and §6
 * (meetings' Reality Layer — "the AI shouldn't simply be agreeable").
 */

describe('role tasks', () => {
  it('gives each role family its own real work, not a shared generic set', () => {
    expect(resolveRoleTasks('Product Manager').map((t) => t.key)).toContain('pm_prd');
    expect(resolveRoleTasks('Backend Engineer').map((t) => t.key)).toContain('eng_debug');
    expect(resolveRoleTasks('Account Executive').map((t) => t.key)).toContain('sales_qualify');
  });

  it('keeps the set small enough to be real work rather than a task list', () => {
    for (const role of ['Product Manager', 'Software Engineer', 'Data Analyst', 'Sales', 'Marketing', 'UX Designer', 'Unknown']) {
      const tasks = resolveRoleTasks(role);
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      expect(tasks.length).toBeLessThanOrEqual(3);
    }
  });

  it('falls back to real generic work for an unrecognised role', () => {
    const tasks = resolveRoleTasks('Chief Astronaut Officer');
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.successCriteria.length > 0)).toBe(true);
  });

  it('every deliverable task has required sections — an empty submission must not reach a reviewer', () => {
    for (const role of ['Product Manager', 'Software Engineer', 'Data Analyst', 'Sales', 'Marketing', 'UX Designer']) {
      for (const task of resolveRoleTasks(role)) {
        if (task.workspace === 'PRIORITIZATION') {
          expect(task.buckets?.length).toBeGreaterThan(1);
        } else {
          expect(task.sections.length).toBeGreaterThan(0);
          expect(task.sections.some((s) => s.required)).toBe(true);
        }
      }
    }
  });

  it('every section carries a hint, so the editor is never an unexplained empty box', () => {
    for (const task of resolveRoleTasks('Product Manager')) {
      for (const s of task.sections) expect(s.hint.length).toBeGreaterThan(10);
    }
  });

  it('sends a PRD to engineering rather than to whoever happens to outrank the room', () => {
    // §Tasks: "Engineering agent reviews the PRD."
    const prd = findRoleTask('Product Manager', 'pm_prd')!;
    expect(prd.reviewerHint).toBeDefined();
    expect(prd.reviewerHint!.test('Engineering Lead')).toBe(true);
    expect(prd.reviewerHint!.test('Head of Sales')).toBe(false);
  });

  it('looks a task back up by key, and returns nothing for a key from another role', () => {
    expect(findRoleTask('Product Manager', 'pm_roadmap')?.workspace).toBe('PRIORITIZATION');
    expect(findRoleTask('Product Manager', 'eng_debug')).toBeUndefined();
  });

  it('uses unique keys within a role so a workspace can always be resolved', () => {
    for (const role of ['Product Manager', 'Software Engineer', 'Sales', 'Marketing']) {
      const keys = resolveRoleTasks(role).map((t) => t.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('meeting reality layer', () => {
  const attendee = {
    id: 'sh-1',
    name: 'Paul Roberts',
    role: 'Engineering Lead',
    department: 'Engineering',
    authorityLevel: 70,
    kpis: ['Sprint predictability'],
    currentTasks: ['Auth migration'],
    personality: { traits: ['blunt'] },
    hiddenIntention: 'Wants headcount before committing to anything',
    privateKnowledge: ['The migration is already two weeks behind'],
    stress: 80,
    urgency: 60,
    patience: 30,
    trust: 40,
    respect: 50,
  };

  it('puts each attendee\'s real stakes in the prompt — the thing the meeting used to lack entirely', () => {
    const card = buildAttendeeCard(attendee, { engineeringCapacity: 45, revenue: 60, sessionId: 'x', updatedAt: new Date() });
    expect(card).toContain('Paul Roberts');
    expect(card).toContain('Sprint predictability');
    expect(card).toContain('Auth migration');
    expect(card).toContain('stress 80');
  });

  it('scopes company state to what that person could actually see from their seat', () => {
    const card = buildAttendeeCard(attendee, { engineeringCapacity: 45, revenue: 60, sessionId: 'x', updatedAt: new Date() });
    expect(card).toContain('engineeringCapacity');
    expect(card).not.toContain('revenue');
  });

  it('marks private knowledge and motives as never-volunteer rather than just listing them', () => {
    const card = buildAttendeeCard(attendee, null);
    expect(card).toContain('ONLY YOU KNOW');
    expect(card).toContain('PRIVATE MOTIVE');
    expect(card).toContain('never volunteer');
  });

  it('describes authority in behavioural terms, not a bare number', () => {
    const senior = buildAttendeeCard({ ...attendee, authorityLevel: 90 }, null);
    const junior = buildAttendeeCard({ ...attendee, authorityLevel: 20 }, null);
    expect(senior).toContain('outrank');
    expect(junior).toContain('junior');
  });

  it('only asks for contradiction-calling when there is actually a record to contradict', () => {
    expect(buildRealityLayerDirective(true, true)).toContain('ACTUALLY TOLD THEM');
    expect(buildRealityLayerDirective(false, false)).not.toContain('ACTUALLY TOLD THEM');
  });

  it('always instructs the room not to default to agreeable', () => {
    for (const [a, b] of [[true, true], [false, false], [true, false]]) {
      expect(buildRealityLayerDirective(a, b)).toContain('NOT default to agreeable');
    }
  });

  it('timestamps prior statements so "that is not what I told you this morning" is possible', () => {
    const out = formatPriorStatements([{ speaker: 'Paul Roberts', at: new Date('2026-09-22T10:02:00Z'), body: 'We cannot ship this week.' }]);
    expect(out).toContain('Paul Roberts');
    expect(out).toContain('We cannot ship this week.');
  });

  it('returns nothing at all when there is no record, rather than an empty header', () => {
    expect(formatPriorStatements([])).toBe('');
    expect(formatCandidateRecord([])).toBe('');
  });
});
