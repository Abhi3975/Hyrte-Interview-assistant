import { resolveSignatureArtifact } from '../src/hyrte/generator/signature-artifacts';

describe('resolveSignatureArtifact (doc §22 — Role-Specific Signature Challenges)', () => {
  it('maps common role titles to a real, distinct artifact type', () => {
    expect(resolveSignatureArtifact('Product Manager').label).toBe('Product Requirements Document (PRD)');
    expect(resolveSignatureArtifact('Software Engineer').label).toBe('Debug Investigation Report');
    expect(resolveSignatureArtifact('Sales Executive').label).toBe('Deal Proposal');
    expect(resolveSignatureArtifact('HR').label).toBe('People Recommendation Memo');
    expect(resolveSignatureArtifact('Finance').label).toBe('Budget Justification Memo');
    expect(resolveSignatureArtifact('Marketing').label).toBe('Campaign Brief');
  });

  it('is case-insensitive and matches within longer free-text role strings (JD-decompose flow)', () => {
    expect(resolveSignatureArtifact('senior product manager, growth').label).toBe('Product Requirements Document (PRD)');
    expect(resolveSignatureArtifact('SOFTWARE ENGINEER II').label).toBe('Debug Investigation Report');
  });

  it('prefers a more specific match over a broader one (DevOps before generic Engineer)', () => {
    expect(resolveSignatureArtifact('DevOps Engineer').label).toBe('Incident Postmortem');
    expect(resolveSignatureArtifact('QA Engineer').label).toBe('Test Plan');
  });

  it('falls back to a generic-but-real deliverable for unrecognized role text, never crashes', () => {
    const resolved = resolveSignatureArtifact('Chief Astronaut Officer');
    expect(resolved.label).toBe('Key Deliverable');
    expect(resolved.promptHint).toContain('real, substantive deliverable');
  });

  it('every resolved template has a non-empty promptHint suitable for prompt grounding', () => {
    for (const role of ['Product Manager', 'Software Engineer', 'DevOps Engineer', 'QA Engineer', 'Data Scientist', 'Data Analyst', 'UX Designer', 'SDR', 'Customer Success', 'Sales', 'Recruiter', 'HR', 'Finance', 'Marketing', 'Project Manager', 'Operations']) {
      const resolved = resolveSignatureArtifact(role);
      expect(resolved.promptHint.length).toBeGreaterThan(20);
      expect(resolved.label.length).toBeGreaterThan(0);
    }
  });
});
