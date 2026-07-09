import { ProctorEventType } from '@prisma/client';

/**
 * Weighted risk configuration.
 *
 * Design goal (per product guidance): NOT every violation should count the
 * same, and NO single transient event should disqualify a candidate. A brief
 * face-detection drop from poor lighting is low weight and decays fast; a
 * second person, a phone, or remote-access software is high weight and sticky.
 *
 * Each signal has:
 *  - weight:     base contribution to the risk score (0-100 scale).
 *  - decayHalfLifeSec: how quickly its contribution fades. Transient/noise
 *                 signals fade fast; deliberate-cheating signals persist.
 *  - minOccurrences: how many times it must be seen within the window before
 *                 it contributes at all — filters one-off false positives.
 *  - category:   grouping used for the explainable risk breakdown.
 */
export interface RiskWeight {
  weight: number;
  decayHalfLifeSec: number;
  minOccurrences: number;
  category: 'identity' | 'vision' | 'object' | 'audio' | 'screen' | 'desktop' | 'ai_cheat';
}

const DEFAULT: RiskWeight = {
  weight: 5,
  decayHalfLifeSec: 120,
  minOccurrences: 2,
  category: 'vision',
};

export const RISK_WEIGHTS: Partial<Record<ProctorEventType, RiskWeight>> = {
  // ── Identity: high-trust signals ──
  IDENTITY_MISMATCH: { weight: 60, decayHalfLifeSec: 3600, minOccurrences: 1, category: 'identity' },
  LIVENESS_FAIL: { weight: 45, decayHalfLifeSec: 1800, minOccurrences: 1, category: 'identity' },
  SPOOF_SUSPECTED: { weight: 55, decayHalfLifeSec: 3600, minOccurrences: 1, category: 'identity' },
  DEEPFAKE_SUSPECTED: { weight: 70, decayHalfLifeSec: 3600, minOccurrences: 1, category: 'identity' },

  // ── Vision: transient, need persistence to matter ──
  FACE_NOT_DETECTED: { weight: 8, decayHalfLifeSec: 45, minOccurrences: 3, category: 'vision' },
  FACE_COVERED: { weight: 15, decayHalfLifeSec: 90, minOccurrences: 2, category: 'vision' },
  LOOKING_AWAY: { weight: 6, decayHalfLifeSec: 40, minOccurrences: 4, category: 'vision' },
  LOOKING_DOWN: { weight: 7, decayHalfLifeSec: 40, minOccurrences: 4, category: 'vision' },
  LOOKING_SIDEWAYS: { weight: 6, decayHalfLifeSec: 40, minOccurrences: 4, category: 'vision' },
  GAZE_OFF_SCREEN: { weight: 6, decayHalfLifeSec: 40, minOccurrences: 4, category: 'vision' },
  MULTIPLE_FACES: { weight: 50, decayHalfLifeSec: 600, minOccurrences: 1, category: 'vision' },
  SUSPICIOUS_BEHAVIOR: { weight: 12, decayHalfLifeSec: 180, minOccurrences: 2, category: 'vision' },

  // ── Object detection: strong signals of external aids ──
  OBJECT_PHONE: { weight: 45, decayHalfLifeSec: 600, minOccurrences: 1, category: 'object' },
  OBJECT_SECONDARY_LAPTOP: { weight: 40, decayHalfLifeSec: 600, minOccurrences: 1, category: 'object' },
  OBJECT_BOOK_NOTES: { weight: 30, decayHalfLifeSec: 300, minOccurrences: 1, category: 'object' },
  OBJECT_HEADPHONES: { weight: 20, decayHalfLifeSec: 300, minOccurrences: 1, category: 'object' },
  OBJECT_ADDITIONAL_MONITOR: { weight: 35, decayHalfLifeSec: 600, minOccurrences: 1, category: 'object' },

  // ── Audio ──
  AUDIO_ADDITIONAL_VOICE: { weight: 40, decayHalfLifeSec: 300, minOccurrences: 1, category: 'audio' },
  AUDIO_WHISPERING: { weight: 25, decayHalfLifeSec: 180, minOccurrences: 2, category: 'audio' },
  AUDIO_EXTERNAL_CONVERSATION: { weight: 35, decayHalfLifeSec: 300, minOccurrences: 1, category: 'audio' },
  AUDIO_AI_ASSISTANCE: { weight: 45, decayHalfLifeSec: 600, minOccurrences: 1, category: 'audio' },
  AUDIO_ANOMALY: { weight: 8, decayHalfLifeSec: 60, minOccurrences: 3, category: 'audio' },

  // ── Screen / focus ──
  TAB_SWITCH: { weight: 12, decayHalfLifeSec: 120, minOccurrences: 2, category: 'screen' },
  WINDOW_BLUR: { weight: 8, decayHalfLifeSec: 90, minOccurrences: 3, category: 'screen' },
  WINDOW_CHANGE: { weight: 12, decayHalfLifeSec: 120, minOccurrences: 2, category: 'screen' },
  FOCUS_LOSS: { weight: 8, decayHalfLifeSec: 90, minOccurrences: 3, category: 'screen' },
  FULLSCREEN_EXIT: { weight: 18, decayHalfLifeSec: 180, minOccurrences: 1, category: 'screen' },
  SCREEN_SHARING: { weight: 50, decayHalfLifeSec: 1800, minOccurrences: 1, category: 'screen' },
  SCREEN_RECORDING_TOOL: { weight: 35, decayHalfLifeSec: 600, minOccurrences: 1, category: 'screen' },

  // ── Desktop agent (Electron) ──
  SUSPICIOUS_PROCESS: { weight: 30, decayHalfLifeSec: 600, minOccurrences: 1, category: 'desktop' },
  SUSPICIOUS_EXTENSION: { weight: 25, decayHalfLifeSec: 600, minOccurrences: 1, category: 'desktop' },
  OVERLAY_APP: { weight: 55, decayHalfLifeSec: 1800, minOccurrences: 1, category: 'desktop' },
  REMOTE_ACCESS_TOOL: { weight: 65, decayHalfLifeSec: 3600, minOccurrences: 1, category: 'desktop' },
  CLIPBOARD_USAGE: { weight: 10, decayHalfLifeSec: 120, minOccurrences: 2, category: 'desktop' },
  SCREEN_CAPTURE_ATTEMPT: { weight: 25, decayHalfLifeSec: 300, minOccurrences: 1, category: 'desktop' },
  DEVICE_CHANGE: { weight: 20, decayHalfLifeSec: 300, minOccurrences: 1, category: 'desktop' },

  // ── AI cheating heuristics ──
  RAPID_ANSWER: { weight: 18, decayHalfLifeSec: 300, minOccurrences: 2, category: 'ai_cheat' },
  AI_LIKE_RESPONSE: { weight: 22, decayHalfLifeSec: 600, minOccurrences: 1, category: 'ai_cheat' },
  COPY_PASTE: { weight: 20, decayHalfLifeSec: 300, minOccurrences: 1, category: 'ai_cheat' },
  UNNATURAL_TYPING: { weight: 15, decayHalfLifeSec: 300, minOccurrences: 2, category: 'ai_cheat' },
  EXTERNAL_ASSISTANCE: { weight: 40, decayHalfLifeSec: 600, minOccurrences: 1, category: 'ai_cheat' },
  PLAGIARISM_FLAG: { weight: 45, decayHalfLifeSec: 1800, minOccurrences: 1, category: 'ai_cheat' },
};

export function weightFor(type: ProctorEventType): RiskWeight {
  return RISK_WEIGHTS[type] ?? DEFAULT;
}

// Risk-score thresholds that escalate warning levels. The 3rd warning
// (MAX_WARNINGS) triggers auto-termination — reconciling the fixed 3-strike
// policy with the weighted, false-positive-resistant model.
export const WARNING_THRESHOLDS = [40, 70, 90] as const; // levels 1, 2, 3
export const MAX_WARNINGS = 3;
