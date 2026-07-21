export interface CameraRigSample {
  departureBlend: number;
  approachBlend: number;
  lateral: number;
  longitudinal: number;
  height: number;
  targetForward: number;
  stationBlend: number;
  targetHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function smoothstep(min: number, max: number, value: number): number {
  const amount = clamp((value - min) / (max - min), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

export function calculateCameraRig(progress: number): CameraRigSample {
  const normalized = clamp(progress, 0, 1);
  const departureBlend = smoothstep(0, 0.28, normalized);
  const approachBlend = smoothstep(0.58, 1, normalized);
  return {
    departureBlend,
    approachBlend,
    lateral: lerp(lerp(7.4, 8.15, departureBlend), 9.35, approachBlend),
    longitudinal: lerp(lerp(3.7, -1.2, departureBlend), 0.35, approachBlend),
    height: lerp(lerp(3.1, 2.75, departureBlend), 3.35, approachBlend),
    targetForward: lerp(-1.35, 0.35, departureBlend),
    stationBlend: approachBlend * 0.52,
    targetHeight: lerp(0.72, 1.05, approachBlend),
  };
}

