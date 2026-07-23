import { describe, expect, it } from 'vitest';
import { JOURNEY_RAMP_FRACTION, sampleJourneyMotion } from './motion';

describe('sampleJourneyMotion', () => {
  it('starts and stops at rest without endpoint acceleration', () => {
    expect(sampleJourneyMotion(0)).toEqual({
      progress: 0,
      normalizedVelocity: 0,
      normalizedAcceleration: 0,
    });
    expect(sampleJourneyMotion(1)).toEqual({
      progress: 1,
      normalizedVelocity: 0,
      normalizedAcceleration: 0,
    });
    expect(sampleJourneyMotion(-1)).toEqual(sampleJourneyMotion(0));
    expect(sampleJourneyMotion(2)).toEqual(sampleJourneyMotion(1));
  });

  it('is monotonic and never inserts a stop during the ride', () => {
    let previous = sampleJourneyMotion(0);
    for (let index = 1; index <= 1000; index += 1) {
      const current = sampleJourneyMotion(index / 1000);
      expect(current.progress).toBeGreaterThan(previous.progress);
      if (index < 1000) expect(current.normalizedVelocity).toBeGreaterThan(0);
      previous = current;
    }
  });

  it('matches position, velocity, and acceleration at both ramp boundaries', () => {
    const epsilon = 1e-7;
    for (const boundary of [JOURNEY_RAMP_FRACTION, 1 - JOURNEY_RAMP_FRACTION]) {
      const left = sampleJourneyMotion(boundary - epsilon);
      const exact = sampleJourneyMotion(boundary);
      const right = sampleJourneyMotion(boundary + epsilon);
      expect(Math.abs(left.progress - right.progress)).toBeLessThan(1e-6);
      expect(Math.abs(left.normalizedVelocity - exact.normalizedVelocity)).toBeLessThan(1e-10);
      expect(Math.abs(right.normalizedVelocity - exact.normalizedVelocity)).toBeLessThan(1e-10);
      expect(Math.abs(left.normalizedAcceleration - exact.normalizedAcceleration)).toBeLessThan(1e-9);
      expect(Math.abs(right.normalizedAcceleration - exact.normalizedAcceleration)).toBeLessThan(1e-9);
    }
  });

  it('reports an analytic velocity that agrees with the progress derivative', () => {
    const step = 1e-5;
    for (let index = 1; index < 100; index += 1) {
      const time = index / 100;
      const before = sampleJourneyMotion(time - step).progress;
      const after = sampleJourneyMotion(time + step).progress;
      const numericalVelocity = (after - before) / (2 * step);
      expect(numericalVelocity).toBeCloseTo(sampleJourneyMotion(time).normalizedVelocity, 6);
    }
  });
});
