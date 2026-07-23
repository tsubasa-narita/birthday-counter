export interface CameraRigSample {
  departureBlend: number;
  approachBlend: number;
  lateral: number;
  longitudinal: number;
  height: number;
  targetForward: number;
  targetLateral: number;
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
    // Pace the leading cab from ahead of the consist. This keeps the E235
    // face visible as a three-quarter portrait instead of flattening the
    // formation into a side-on rectangle halfway through the trip.
    lateral: lerp(lerp(7.4, 6.5, departureBlend), 8, approachBlend),
    longitudinal: lerp(lerp(3.7, 5, departureBlend), 7, approachBlend),
    height: lerp(lerp(3.1, 2.25, departureBlend), 2.8, approachBlend),
    targetForward: lerp(lerp(-1.35, -1.2, departureBlend), -1, approachBlend),
    // Let the station share the frame without pulling focus away from the
    // train. The architecture has already been moved close to the stop.
    targetLateral: stationFocusBlend === 0 ? 0 : stationFocusBlend * -0.35,
    stationBlend: stationFocusBlend * 0.14,
    targetHeight: lerp(lerp(0.72, 0.9, departureBlend), 1.65, approachBlend),
  };
}
