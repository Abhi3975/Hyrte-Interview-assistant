import { ProctorEvent, ProctorEventType, ProctorSeverity } from '@prisma/client';
import { RiskEngine } from '../src/proctoring/risk-engine.service';

/** Build a minimal ProctorEvent for the pure engine. */
function ev(
  type: ProctorEventType,
  agoSec = 0,
  severity: ProctorSeverity = 'MEDIUM',
): ProctorEvent {
  return {
    id: Math.random().toString(36).slice(2),
    sessionId: 's1',
    type,
    severity,
    payload: {},
    evidenceUrl: null,
    provider: 'internal',
    occurredAt: new Date(Date.now() - agoSec * 1000),
  } as ProctorEvent;
}

describe('RiskEngine', () => {
  const engine = new RiskEngine();

  it('ignores a single transient face-detection blip (noise gate)', () => {
    // FACE_NOT_DETECTED needs >= 3 occurrences before it counts at all.
    const result = engine.compute([ev('FACE_NOT_DETECTED')]);
    expect(result.riskScore).toBe(0);
  });

  it('keeps repeated transient blips low-risk', () => {
    const events = [ev('FACE_NOT_DETECTED'), ev('FACE_NOT_DETECTED'), ev('FACE_NOT_DETECTED')];
    const result = engine.compute(events);
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.riskScore).toBeLessThan(40); // never trips a warning on its own
  });

  it('treats a single second-person detection as materially higher risk', () => {
    const faces = engine.compute([
      ev('FACE_NOT_DETECTED'),
      ev('FACE_NOT_DETECTED'),
      ev('FACE_NOT_DETECTED'),
    ]).riskScore;
    const second = engine.compute([ev('MULTIPLE_FACES', 0, 'HIGH')]).riskScore;
    expect(second).toBeGreaterThan(faces);
  });

  it('escalates high-weight deliberate signals past the L1 threshold', () => {
    const result = engine.compute([
      ev('REMOTE_ACCESS_TOOL', 0, 'CRITICAL'),
      ev('OBJECT_PHONE', 0, 'HIGH'),
    ]);
    expect(result.riskScore).toBeGreaterThanOrEqual(40);
    expect(result.topSignals).toContain('REMOTE_ACCESS_TOOL');
  });

  it('decays older evidence (recent counts more than stale)', () => {
    const recent = engine.compute([ev('OBJECT_PHONE', 0, 'HIGH')]).riskScore;
    const stale = engine.compute([ev('OBJECT_PHONE', 1800, 'HIGH')]).riskScore;
    expect(recent).toBeGreaterThan(stale);
  });

  it('raises confidence as corroborating evidence accumulates', () => {
    const few = engine.compute([ev('TAB_SWITCH'), ev('TAB_SWITCH')]).confidenceScore;
    const many = engine.compute(
      Array.from({ length: 10 }, () => ev('TAB_SWITCH')),
    ).confidenceScore;
    expect(many).toBeGreaterThan(few);
  });

  it('produces an explainable category breakdown', () => {
    const result = engine.compute([
      ev('OBJECT_PHONE', 0, 'HIGH'),
      ev('REMOTE_ACCESS_TOOL', 0, 'CRITICAL'),
    ]);
    expect(Object.keys(result.breakdown)).toEqual(expect.arrayContaining(['object', 'desktop']));
  });
});
