import { burstSizeForLiveScore, chaosWaveCadenceForLiveScore, livePerformanceScore } from '../src/hyrte/consequences/consequence.service';

describe('livePerformanceScore (Dynamic Difficulty — a live read of actual company state, not a one-time calibration snapshot)', () => {
  it('scores a healthy company state high', () => {
    const healthy = { customerSatisfaction: 80, revenue: 80, teamMorale: 80, productQuality: 80, marketReputation: 80, growth: 80, riskLevel: 20, burnout: 20, technicalDebt: 20, complianceRisk: 20, operationalRisk: 20, deadlinePressure: 20 };
    expect(livePerformanceScore(healthy)).toBeGreaterThan(75);
  });

  it('scores a struggling company state low', () => {
    const struggling = { customerSatisfaction: 15, revenue: 15, teamMorale: 15, productQuality: 15, marketReputation: 15, growth: 15, riskLevel: 85, burnout: 85, technicalDebt: 85, complianceRisk: 85, operationalRisk: 85, deadlinePressure: 85 };
    expect(livePerformanceScore(struggling)).toBeLessThan(25);
  });

  it('treats a missing key as neutral (50) rather than crashing or skewing the average', () => {
    expect(livePerformanceScore({})).toBe(50);
  });
});

describe('chaosWaveCadenceForLiveScore', () => {
  it('shortens the cadence when the candidate is doing well — more pressure, per the doc', () => {
    expect(chaosWaveCadenceForLiveScore(85)).toBeLessThan(chaosWaveCadenceForLiveScore(50));
  });

  it('lengthens the cadence when the candidate is struggling — reduces chaos, per the doc', () => {
    expect(chaosWaveCadenceForLiveScore(20)).toBeGreaterThan(chaosWaveCadenceForLiveScore(50));
  });

  it('falls back to the base cadence with no live score (wave 1 has none yet)', () => {
    expect(chaosWaveCadenceForLiveScore(undefined)).toBe(150_000);
  });
});

describe('burstSizeForLiveScore', () => {
  it('adds density when doing well, without exceeding the sanity ceiling', () => {
    expect(burstSizeForLiveScore(3, 85)).toBe(4);
    expect(burstSizeForLiveScore(6, 85)).toBe(6); // clamped at CHAOS_WAVE_BURST_MAX
  });

  it('removes density when struggling, without dropping below the floor', () => {
    expect(burstSizeForLiveScore(3, 20)).toBe(2);
    expect(burstSizeForLiveScore(2, 20)).toBe(2); // clamped at CHAOS_WAVE_BURST_MIN
  });

  it('leaves burst size untouched in the neutral band', () => {
    expect(burstSizeForLiveScore(3, 50)).toBe(3);
  });
});
