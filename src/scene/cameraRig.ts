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
    // Portrait framing needs more distance than desktop: the train extends
    // along the track while the station occupies the opposite side of frame.
    lateral: lerp(lerp(7.4, 9.2, departureBlend), 7.9, approachBlend),
    // Stay close enough for the cab to remain the hero. The architecture is
    // moved toward the stop marker instead of sending the camera far ahead.
    longitudinal: lerp(lerp(3.7, -1.2, departureBlend), 2.4, approachBlend),
    height: lerp(lerp(3.1, 2.75, departureBlend), 3.05, approachBlend),
    targetForward: lerp(lerp(-1.35, -1.6, departureBlend), -0.55, approachBlend),
    // The station sits across the track from the camera. Aim between the cab
    // and facade only on the final approach so departure remains unchanged.
    targetLateral: stationFocusBlend === 0 ? 0 : stationFocusBlend * -1.1,
    stationBlend: stationFocusBlend * 0.27,
    targetHeight: lerp(0.72, 2.3, approachBlend),
  };
}
