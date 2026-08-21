import type { CompanyStateKey } from '../consequences/consequence.service';

/**
 * Recruiter-side doc §2 — "Don't build 100 industries. Build templates.
 * Everything derives from them." Before this, `industry` was a free-text
 * field only nominally constrained to 5 options in the frontend picker
 * (SaaS/Healthcare/E-commerce/Manufacturing/Banking) with zero behavioral
 * effect beyond appearing as a word inside a couple of prompt sentences —
 * two sessions with different industries were structurally identical.
 *
 * This is a real, finite set of CATEGORY-level templates (the doc's own
 * ~10 top-level groupings), each with genuine, code-level effects:
 * - `companyStateBias`: a deterministic nudge applied to the generated
 *   HyrteCompanyState after generation (same "structural guarantee from
 *   code, not a prompt hope" discipline as P5's 84-parameter taxonomy and
 *   P2's round sequences) — two sessions in different industries now
 *   provably start with different risk profiles, not just different words.
 * - `primaryMetrics`: which of the universal 16 company-state keys this
 *   industry cares about most — read by Analytics/report code elsewhere as
 *   the industry's real "success metrics" (the doc's own term), rather than
 *   inventing a second parallel metrics system.
 * - `groundingNote`: real, concrete vocabulary/stakeholder-archetype/
 *   typical-crisis grounding woven into the world-generation prompts, so
 *   generated content (stakeholders, KB docs, chaos events) is actually
 *   differentiated per industry, not just labeled with it.
 *
 * Verticals (the doc's sub-categories, e.g. FinTech under Technology) are
 * real, distinct, selectable options — each carries its own label/flavor
 * into prompts — but inherit their parent category's template rather than
 * each having a fully bespoke one, matching the doc's own explicit
 * "everything derives from them" instruction.
 */

export interface IndustryVertical {
  id: string;
  label: string;
}

export interface IndustryCategory {
  id: string;
  label: string;
  verticals: IndustryVertical[];
}

export interface IndustryTemplate {
  companyStateBias: Partial<Record<CompanyStateKey, number>>;
  primaryMetrics: CompanyStateKey[];
  vocabulary: string;
  stakeholderArchetypes: string[];
  typicalCrises: string[];
}

export const INDUSTRY_CATEGORIES: IndustryCategory[] = [
  {
    id: 'technology',
    label: 'Technology',
    verticals: [
      { id: 'saas', label: 'SaaS' },
      { id: 'ai', label: 'AI' },
      { id: 'cybersecurity', label: 'Cybersecurity' },
      { id: 'fintech', label: 'FinTech' },
      { id: 'edtech', label: 'EdTech' },
      { id: 'hrtech', label: 'HRTech' },
      { id: 'devtools', label: 'DevTools' },
      { id: 'cloud', label: 'Cloud' },
      { id: 'gaming', label: 'Gaming' },
    ],
  },
  {
    id: 'commerce',
    label: 'Commerce',
    verticals: [
      { id: 'ecommerce', label: 'Ecommerce' },
      { id: 'retail', label: 'Retail' },
      { id: 'd2c', label: 'D2C' },
      { id: 'marketplace', label: 'Marketplace' },
      { id: 'luxury', label: 'Luxury' },
      { id: 'fmcg', label: 'FMCG' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    verticals: [
      { id: 'banking', label: 'Banking' },
      { id: 'insurance', label: 'Insurance' },
      { id: 'asset_management', label: 'Asset Management' },
      { id: 'payments', label: 'Payments' },
      { id: 'investment', label: 'Investment' },
      { id: 'lending', label: 'Lending' },
    ],
  },
  {
    id: 'healthcare',
    label: 'Healthcare',
    verticals: [
      { id: 'hospitals', label: 'Hospitals' },
      { id: 'pharma', label: 'Pharma' },
      { id: 'diagnostics', label: 'Diagnostics' },
      { id: 'medical_devices', label: 'Medical Devices' },
      { id: 'healthtech', label: 'HealthTech' },
    ],
  },
  {
    id: 'manufacturing',
    label: 'Manufacturing',
    verticals: [
      { id: 'automobile', label: 'Automobile' },
      { id: 'electronics', label: 'Electronics' },
      { id: 'aerospace', label: 'Aerospace' },
      { id: 'industrial', label: 'Industrial' },
      { id: 'chemicals', label: 'Chemicals' },
    ],
  },
  {
    id: 'logistics',
    label: 'Logistics',
    verticals: [
      { id: 'supply_chain', label: 'Supply Chain' },
      { id: 'warehousing', label: 'Warehousing' },
      { id: 'shipping', label: 'Shipping' },
      { id: 'aviation', label: 'Aviation' },
      { id: 'mobility', label: 'Mobility' },
    ],
  },
  {
    id: 'consulting',
    label: 'Consulting',
    verticals: [
      { id: 'management', label: 'Management' },
      { id: 'strategy', label: 'Strategy' },
      { id: 'big4', label: 'Big 4' },
      { id: 'tech_consulting', label: 'Technology Consulting' },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    verticals: [
      { id: 'agency', label: 'Agency' },
      { id: 'performance', label: 'Performance' },
      { id: 'brand', label: 'Brand' },
      { id: 'media', label: 'Media' },
    ],
  },
  {
    id: 'hospitality',
    label: 'Hospitality',
    verticals: [
      { id: 'hotels', label: 'Hotels' },
      { id: 'restaurants', label: 'Restaurants' },
      { id: 'travel', label: 'Travel' },
      { id: 'airlines', label: 'Airlines' },
    ],
  },
  {
    id: 'government',
    label: 'Government',
    verticals: [
      { id: 'public_sector', label: 'Public Sector' },
      { id: 'defense', label: 'Defense' },
      { id: 'municipal', label: 'Municipal' },
      { id: 'utilities', label: 'Utilities' },
    ],
  },
  {
    id: 'education',
    label: 'Education',
    verticals: [
      { id: 'schools', label: 'Schools' },
      { id: 'universities', label: 'Universities' },
      { id: 'edtech_edu', label: 'EdTech Provider' },
      { id: 'training', label: 'Training' },
    ],
  },
];

export const INDUSTRY_TEMPLATE_BY_CATEGORY: Record<string, IndustryTemplate> = {
  technology: {
    companyStateBias: { technicalDebt: 10, engineeringCapacity: -5 },
    primaryMetrics: ['productQuality', 'engineeringCapacity', 'technicalDebt', 'growth'],
    vocabulary: 'sprints, technical debt, deployment, API reliability, uptime, feature velocity',
    stakeholderArchetypes: ['Engineering Lead', 'Product Manager', 'DevOps/SRE', 'Data/Analytics'],
    typicalCrises: ['a critical bug reaching production', 'a competitor shipping a similar feature first', 'the platform struggling under a sudden load spike'],
  },
  commerce: {
    companyStateBias: { cashRunway: -5, marketReputation: 5 },
    primaryMetrics: ['revenue', 'customerSatisfaction', 'growth', 'marketReputation'],
    vocabulary: 'conversion rate, cart abandonment, inventory, fulfillment, seasonality, returns',
    stakeholderArchetypes: ['Merchandising Lead', 'Supply Chain Manager', 'Growth Marketer', 'Customer Experience Lead'],
    typicalCrises: ['a supply chain delay right before a peak sales period', 'a viral negative review', 'a payment processing outage during checkout'],
  },
  finance: {
    companyStateBias: { complianceRisk: 15, riskLevel: 5 },
    primaryMetrics: ['complianceRisk', 'riskLevel', 'revenue', 'customerSatisfaction'],
    vocabulary: 'regulatory compliance, audit trail, risk exposure, capital reserves, KYC/AML, reconciliation',
    stakeholderArchetypes: ['Compliance Officer', 'Risk Manager', 'Relationship Manager', 'Product Lead'],
    typicalCrises: ['an unfavorable regulatory audit finding', 'a data exposure involving financial records', 'an approaching compliance deadline'],
  },
  healthcare: {
    companyStateBias: { complianceRisk: 20, operationalRisk: 10 },
    primaryMetrics: ['complianceRisk', 'productQuality', 'operationalRisk', 'customerSatisfaction'],
    vocabulary: 'patient safety, regulatory compliance, clinical validation, care quality, protocol adherence',
    stakeholderArchetypes: ['Clinical Lead', 'Compliance/Quality Officer', 'Care Operations Manager', 'Patient Experience Lead'],
    typicalCrises: ['a patient-safety-adjacent incident', 'an upcoming compliance audit', 'a clinical data discrepancy needing investigation'],
  },
  manufacturing: {
    companyStateBias: { operationalRisk: 15, technicalDebt: 5 },
    primaryMetrics: ['operationalRisk', 'productQuality', 'engineeringCapacity', 'budget'],
    vocabulary: 'supply chain, quality control, safety standards, production line, defect rate, yield',
    stakeholderArchetypes: ['Plant/Operations Manager', 'Quality Assurance Lead', 'Supply Chain Manager', 'Safety Officer'],
    typicalCrises: ['a defect discovered in a production batch', 'a key supplier delay', 'a safety compliance issue on the floor'],
  },
  logistics: {
    companyStateBias: { operationalRisk: 15, deadlinePressure: 10 },
    primaryMetrics: ['operationalRisk', 'deadlinePressure', 'customerSatisfaction', 'budget'],
    vocabulary: 'fleet utilization, route optimization, on-time delivery, warehousing capacity, last-mile',
    stakeholderArchetypes: ['Operations Manager', 'Fleet/Warehouse Lead', 'Customer Logistics Lead', 'Planning Analyst'],
    typicalCrises: ['a major shipment delay affecting a key client', 'a sudden fleet/capacity shortage', 'a customs or regulatory hold'],
  },
  consulting: {
    companyStateBias: { teamMorale: -5, deadlinePressure: 10 },
    primaryMetrics: ['customerSatisfaction', 'revenue', 'teamMorale', 'marketReputation'],
    vocabulary: 'client engagement, deliverables, billable utilization, stakeholder alignment, scope',
    stakeholderArchetypes: ['Engagement Manager', 'Practice Lead', 'Client Partner', 'Analyst'],
    typicalCrises: ['a client escalation over a missed deliverable', 'scope creep threatening an engagement\'s margin', 'a staffing conflict across two engagements'],
  },
  marketing: {
    companyStateBias: { marketReputation: 5, deadlinePressure: 10 },
    primaryMetrics: ['marketReputation', 'growth', 'revenue', 'customerSatisfaction'],
    vocabulary: 'campaign performance, brand positioning, ROAS, creative review, media mix',
    stakeholderArchetypes: ['Campaign Manager', 'Creative Lead', 'Client/Brand Lead', 'Performance Analyst'],
    typicalCrises: ['a campaign underperforming right before a launch', 'brand-damaging public feedback', 'a client demanding late-stage creative changes'],
  },
  hospitality: {
    companyStateBias: { customerSatisfaction: 5, teamMorale: -5 },
    primaryMetrics: ['customerSatisfaction', 'marketReputation', 'revenue', 'teamMorale'],
    vocabulary: 'guest experience, occupancy, service quality, peak-season staffing, reviews',
    stakeholderArchetypes: ['General Manager', 'Guest Experience Lead', 'Operations/Staffing Manager', 'Revenue Manager'],
    typicalCrises: ['a high-profile guest complaint going public', 'a staffing shortage during peak season', 'a service-quality incident during a busy period'],
  },
  government: {
    companyStateBias: { complianceRisk: 15, deadlinePressure: 5 },
    primaryMetrics: ['complianceRisk', 'operationalRisk', 'budget', 'customerSatisfaction'],
    vocabulary: 'public accountability, procurement, regulatory oversight, constituent services, transparency',
    stakeholderArchetypes: ['Program Director', 'Compliance/Oversight Lead', 'Operations Manager', 'Public Affairs Lead'],
    typicalCrises: ['a public accountability or transparency demand', 'a budget or procurement constraint', 'a service-delivery failure affecting constituents'],
  },
  education: {
    companyStateBias: { budget: -5, customerSatisfaction: 5 },
    primaryMetrics: ['customerSatisfaction', 'productQuality', 'budget', 'growth'],
    vocabulary: 'learning outcomes, enrollment, curriculum, accreditation, student engagement',
    stakeholderArchetypes: ['Academic/Program Lead', 'Operations Manager', 'Student Success Lead', 'Enrollment Manager'],
    typicalCrises: ['an accreditation or compliance review', 'a decline in enrollment', 'a learning-outcomes shortfall surfacing in data'],
  },
};

/** Accepts either a category id or a vertical id (candidates pick a vertical; recruiter JD-decompose flows may pass a category or free text). */
export function resolveIndustryTemplate(industry: string): { categoryId: string; label: string; template: IndustryTemplate } | null {
  const norm = industry.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const trimmedLower = industry.trim().toLowerCase();
  // Verticals first: they're what the real picker actually sends, and a
  // vertical match is strictly more specific than a bare category match.
  // (A category id/label CAN collide with a sibling category's vertical
  // label — e.g. Consulting's "Technology" sub-item vs. the Technology
  // category itself — checking verticals first resolves that correctly.)
  for (const category of INDUSTRY_CATEGORIES) {
    const vertical = category.verticals.find((v) => v.id === norm || v.label.toLowerCase() === trimmedLower);
    if (vertical) {
      return { categoryId: category.id, label: vertical.label, template: INDUSTRY_TEMPLATE_BY_CATEGORY[category.id] };
    }
  }
  // Fall back to a bare category id/label — real for freeform text (e.g. a
  // JD-decomposition guess) that names the category but no specific vertical.
  for (const category of INDUSTRY_CATEGORIES) {
    if (category.id === norm || category.label.toLowerCase() === trimmedLower) {
      return { categoryId: category.id, label: category.label, template: INDUSTRY_TEMPLATE_BY_CATEGORY[category.id] };
    }
  }
  return null;
}

/** Real prompt grounding — concrete vocabulary/archetypes/crises, not just the industry's name in a sentence. */
export function industryGroundingNote(industry: string): string {
  const resolved = resolveIndustryTemplate(industry);
  if (!resolved) return '';
  const { label, template } = resolved;
  return (
    `\n\nINDUSTRY GROUNDING (${label}): use real, concrete vocabulary this industry actually uses — ` +
    `${template.vocabulary}. Stakeholder roles should feel native to this industry, e.g. ${template.stakeholderArchetypes.join(', ')}. ` +
    `Any crisis/problem generated should plausibly resemble the kind this industry actually has, e.g. ` +
    `${template.typicalCrises.join('; ')} — not a generic tech-startup problem transplanted here.`
  );
}

const MAX_BIAS_DELTA = 20;

/** Deterministic, code-level bias applied AFTER generation — same "the guarantee comes from code, not a prompt hope" discipline as the rest of this codebase's structural fixes. */
export function applyIndustryBias<T extends Partial<Record<CompanyStateKey, number>>>(companyState: T, industry: string): T {
  const resolved = resolveIndustryTemplate(industry);
  if (!resolved) return companyState;
  const biased = { ...companyState };
  for (const [key, delta] of Object.entries(resolved.template.companyStateBias) as [CompanyStateKey, number][]) {
    const current = typeof biased[key] === 'number' ? (biased[key] as number) : 50;
    const clampedDelta = Math.max(-MAX_BIAS_DELTA, Math.min(MAX_BIAS_DELTA, delta));
    (biased as Record<string, number>)[key] = Math.max(0, Math.min(100, current + clampedDelta));
  }
  return biased;
}
