import { LicenseType } from '@prisma/client';

/**
 * License compliance gate for the Question Aggregator.
 *
 * Enforces the Question Sources Policy: ONLY permissive / public-domain /
 * owned / user-granted / AI-generated content may enter the corpus. Anything
 * else (scraped premium banks, copyrighted proprietary content) is rejected
 * before it can be stored.
 */

// The allowlist. Everything not listed here is denied by default.
const ALLOWED_LICENSES: ReadonlySet<LicenseType> = new Set([
  'MIT',
  'APACHE_2_0',
  'BSD_2_CLAUSE',
  'BSD_3_CLAUSE',
  'CC_BY_4_0',
  'CC0_PUBLIC_DOMAIN',
  'PROPRIETARY_OWNED',
  'USER_GRANTED',
  'AI_GENERATED',
]);

// CC-BY requires attribution to be preserved and shown.
const ATTRIBUTION_REQUIRED: ReadonlySet<LicenseType> = new Set(['CC_BY_4_0']);

// Explicitly blocked source hosts — a defense-in-depth denylist that stops
// accidental ingestion of known proprietary interview banks.
const BLOCKED_SOURCE_HOSTS = [
  'leetcode.com',
  'interviewbit.com',
  'geeksforgeeks.org',
  'hackerrank.com',
  'coursera.org',
  'udemy.com',
];

// Raw license identifiers (SPDX-ish strings) mapped to our enum.
const SPDX_MAP: Record<string, LicenseType> = {
  mit: 'MIT',
  'apache-2.0': 'APACHE_2_0',
  apache2: 'APACHE_2_0',
  'bsd-2-clause': 'BSD_2_CLAUSE',
  'bsd-3-clause': 'BSD_3_CLAUSE',
  'cc-by-4.0': 'CC_BY_4_0',
  'cc-by': 'CC_BY_4_0',
  cc0: 'CC0_PUBLIC_DOMAIN',
  'cc0-1.0': 'CC0_PUBLIC_DOMAIN',
  'public-domain': 'CC0_PUBLIC_DOMAIN',
};

export interface LicenseCandidate {
  rawLicense?: string;      // e.g. "MIT", "cc-by-4.0"
  licenseType?: LicenseType; // if already normalized
  sourceUrl?: string;
  attribution?: string;
}

export interface LicenseDecision {
  allowed: boolean;
  reason?: string;
  licenseType?: LicenseType;
  requiresAttribution: boolean;
}

export class LicenseValidator {
  /** Returns whether a candidate may be ingested, and why not if rejected. */
  validate(candidate: LicenseCandidate): LicenseDecision {
    // 1) Hard block known proprietary hosts regardless of claimed license.
    if (candidate.sourceUrl) {
      const host = safeHost(candidate.sourceUrl);
      if (host && BLOCKED_SOURCE_HOSTS.some((b) => host.endsWith(b))) {
        return {
          allowed: false,
          reason: `Source host "${host}" is on the proprietary denylist`,
          requiresAttribution: false,
        };
      }
    }

    // 2) Resolve the license type.
    const type =
      candidate.licenseType ??
      (candidate.rawLicense ? SPDX_MAP[candidate.rawLicense.trim().toLowerCase()] : undefined);

    if (!type) {
      return {
        allowed: false,
        reason: `Unrecognized or missing license: "${candidate.rawLicense ?? 'none'}"`,
        requiresAttribution: false,
      };
    }

    // 3) Allowlist check.
    if (!ALLOWED_LICENSES.has(type)) {
      return {
        allowed: false,
        reason: `License ${type} is not in the permissive allowlist`,
        requiresAttribution: false,
      };
    }

    const requiresAttribution = ATTRIBUTION_REQUIRED.has(type);
    if (requiresAttribution && !candidate.attribution) {
      return {
        allowed: false,
        reason: `License ${type} requires attribution, but none was provided`,
        licenseType: type,
        requiresAttribution: true,
      };
    }

    return { allowed: true, licenseType: type, requiresAttribution };
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}
