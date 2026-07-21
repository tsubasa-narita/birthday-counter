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
  // The station is still far ahead at 60–80% of the route. Looking at it too
  // early pulls the train completely out of a portrait frame, so station
  // focus begins only once the consist is on the final platform approach.
  const stationFocusBlend = smoothstep(0.82, 1, normalized);
  return {
    departureBlend,
    approachBlend,
    // Finish with a gentle push-in: the cab grows in the frame while the
    // compact station sign remains fully legible above it on a phone.
    lateral: lerp(lerp(7.4, 8.15, departureBlend), 7.7, approachBlend),
    // Move ahead of the nose for a three-quarter portrait of the E235 cab at
    // the platform, instead of ending on a flat side-on silhouette.
    longitudinal: lerp(lerp(3.7, -1.2, departureBlend), 3.2, approachBlend),
    height: lerp(lerp(3.1, 2.75, departureBlend), 3.05, approachBlend),
    targetForward: lerp(lerp(-1.35, 0.35, departureBlend), -0.55, approachBlend),
    stationBlend: stationFocusBlend * 0.25,
    targetHeight: lerp(0.72, 1.42, approachBlend),
  };
}
