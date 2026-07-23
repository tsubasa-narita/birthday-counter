export interface JourneyMotionSample {
  progress: number;
  /** dp / d(normalizedTime). Divide by duration seconds for progress/second. */
  normalizedVelocity: number;
  /** d²p / d(normalizedTime)². Divide by duration² for progress/second². */
  normalizedAcceleration: number;
}

// Each end uses a quintic velocity ramp. The remaining interval is a calm,
// constant-speed cruise. The ramps meet the cruise with matching velocity and
// acceleration, so there is no hidden stop or kick at a timeline boundary.
export const JOURNEY_RAMP_FRACTION = 0.24;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smootherstep(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function smootherstepDerivative(value: number): number {
  const complement = value - 1;
  return 30 * value * value * complement * complement;
}

// Exact integral of 6x^5 - 15x^4 + 10x^3, with F(0)=0 and F(1)=1/2.
function integratedSmootherstep(value: number): number {
  const square = value * value;
  const fourth = square * square;
  return fourth * (value * value - 3 * value + 2.5);
}

/**
 * Samples the complete ride as one C²-continuous motion profile.
 *
 * `normalizedTime` is elapsed/duration. The returned velocity and acceleration
 * are analytic derivatives, allowing wheel motion to follow the train instead
 * of using an unrelated per-segment decorative speed.
 */
export function sampleJourneyMotion(normalizedTime: number): JourneyMotionSample {
  const time = clamp01(Number.isFinite(normalizedTime) ? normalizedTime : 0);
  if (time === 0) return { progress: 0, normalizedVelocity: 0, normalizedAcceleration: 0 };
  if (time === 1) return { progress: 1, normalizedVelocity: 0, normalizedAcceleration: 0 };
  const ramp = JOURNEY_RAMP_FRACTION;
  // Two half-area ramps plus the cruise integrate to (1 - ramp).
  const cruiseVelocity = 1 / (1 - ramp);

  if (time < ramp) {
    const local = time / ramp;
    return {
      progress: cruiseVelocity * ramp * integratedSmootherstep(local),
      normalizedVelocity: cruiseVelocity * smootherstep(local),
      normalizedAcceleration: cruiseVelocity / ramp * smootherstepDerivative(local),
    };
  }

  if (time <= 1 - ramp) {
    return {
      progress: cruiseVelocity * (ramp * 0.5 + time - ramp),
      normalizedVelocity: cruiseVelocity,
      normalizedAcceleration: 0,
    };
  }

  const local = (1 - time) / ramp;
  return {
    progress: 1 - cruiseVelocity * ramp * integratedSmootherstep(local),
    normalizedVelocity: cruiseVelocity * smootherstep(local),
    normalizedAcceleration: -cruiseVelocity / ramp * smootherstepDerivative(local),
  };
}
