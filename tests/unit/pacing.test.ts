import { warmupMultiplier } from '../../src/content/rsvp/pacing';

describe('warmupMultiplier', () => {
  it('starts at 80% speed and ramps to 100%', () => {
    expect(warmupMultiplier(0, true)).toBeCloseTo(0.8);
    expect(warmupMultiplier(10_000, true)).toBeCloseTo(1);
  });
});
