/**
 * Recruiter doc §2 — real industry templates (~10 categories, each with real
 * sub-verticals), mirroring apps/api/src/hyrte/generator/industry-templates.ts
 * on the backend. Kept as a plain duplicated constant rather than fetched
 * from an endpoint — same convention as every other static option list in
 * this app (ROLES/EXPERIENCE_LEVELS/etc.), and this data changes about as
 * often as those do.
 */
export interface IndustryCategory {
  id: string;
  label: string;
  verticals: { id: string; label: string }[];
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

/** Flat list of every vertical label, for simple pickers/fuzzy-matching that don't need the grouping. */
export const INDUSTRY_VERTICAL_LABELS: string[] = INDUSTRY_CATEGORIES.flatMap((c) => c.verticals.map((v) => v.label));
