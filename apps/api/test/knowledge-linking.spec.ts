import { findMentionedKnowledgeDoc, isDocRelevantToRole, resolveRelevantRoles } from '../src/hyrte/generator/knowledge-linking';

describe('resolveRelevantRoles (refinements doc §8 — Role-Specific Knowledge Bases)', () => {
  it('tags PM-relevant categories', () => {
    expect(resolveRelevantRoles('prd')).toContain('Product');
    expect(resolveRelevantRoles('roadmap')).toContain('Product');
  });

  it('tags engineering-relevant categories', () => {
    expect(resolveRelevantRoles('wiki')).toContain('Engineer');
    expect(resolveRelevantRoles('backlog')).toContain('Engineer');
  });

  it('tags sales-relevant categories', () => {
    expect(resolveRelevantRoles('sales_deck')).toContain('Sales');
    expect(resolveRelevantRoles('customer_history')).toContain('Sales');
  });

  it('tags finance-relevant categories', () => {
    expect(resolveRelevantRoles('financial_report')).toContain('Finance');
  });

  it('returns empty (universal) for meeting notes and unrecognized categories', () => {
    expect(resolveRelevantRoles('meeting_notes')).toEqual([]);
    expect(resolveRelevantRoles('something_the_llm_made_up')).toEqual([]);
  });

  it('is case/whitespace tolerant', () => {
    expect(resolveRelevantRoles('  PRD  ')).toContain('Product');
  });
});

describe('isDocRelevantToRole (refinements doc §8 — never hides, only sorts)', () => {
  it('matches a role that fuzzily contains a relevant-role hint', () => {
    expect(isDocRelevantToRole(['Product', 'Engineer'], 'Senior Product Manager')).toBe(true);
    expect(isDocRelevantToRole(['Engineer'], 'Backend Engineer II')).toBe(true);
  });

  it('does not match an unrelated role', () => {
    expect(isDocRelevantToRole(['Finance'], 'Product Manager')).toBe(false);
  });

  it('an empty relevantRoles list (universal doc) is relevant to every role', () => {
    expect(isDocRelevantToRole([], 'Anything At All')).toBe(true);
  });
});

describe('findMentionedKnowledgeDoc (refinements doc §8 — "Knowledge as Part of Work")', () => {
  const docs = [
    { id: 'doc-roadmap', title: 'Q4 Product Roadmap', category: 'roadmap' },
    { id: 'doc-prd', title: 'Onboarding PRD', category: 'prd' },
    { id: 'doc-financial', title: 'Q3 Financial Report', category: 'financial_report' },
  ];

  it('links via an exact title mention, even generated independently of the doc', () => {
    expect(findMentionedKnowledgeDoc('Please review the Q4 Product Roadmap before replying.', docs)).toBe('doc-roadmap');
  });

  it('links via a category keyword when exactly one doc exists in that category', () => {
    expect(findMentionedKnowledgeDoc('Can you check the roadmap for Q4 priorities?', docs)).toBe('doc-roadmap');
    expect(findMentionedKnowledgeDoc('Finance needs the latest financial report before signing off.', docs)).toBe('doc-financial');
  });

  it('does not link an ambiguous category (2+ docs share it)', () => {
    const ambiguous = [
      { id: 'doc-a', title: 'Engineering Wiki', category: 'wiki' },
      { id: 'doc-b', title: 'Onboarding Wiki', category: 'wiki' },
    ];
    expect(findMentionedKnowledgeDoc('See the wiki for details.', ambiguous)).toBeUndefined();
  });

  it('returns undefined for a message that plausibly references nothing', () => {
    expect(findMentionedKnowledgeDoc('Lunch plans for Friday?', docs)).toBeUndefined();
  });

  it('is a safe no-op on empty text or an empty doc list', () => {
    expect(findMentionedKnowledgeDoc('', docs)).toBeUndefined();
    expect(findMentionedKnowledgeDoc('the roadmap', [])).toBeUndefined();
  });

  it('prefers the longer/more specific title match when titles overlap', () => {
    const overlapping = [
      { id: 'doc-short', title: 'Roadmap', category: 'roadmap' },
      { id: 'doc-long', title: 'Q4 Enterprise Roadmap', category: 'roadmap' },
    ];
    expect(findMentionedKnowledgeDoc('Check the Q4 Enterprise Roadmap.', overlapping)).toBe('doc-long');
  });
});
