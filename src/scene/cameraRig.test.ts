import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { calculateCameraRig } from './cameraRig';
import { E235_DIMENSIONS } from './e235';
import {
  ARRIVAL_ADVANCE_SIGN_PLACEMENT,
  ARRIVAL_ADVANCE_SIGN_RAIL,
  ARRIVAL_SIGN_PLACEMENT,
  BIRTHDAY_STATION_RAIL,
  createRailCurve,
  DEPARTURE_SIGN_PLACEMENT,
  JOURNEY_RAIL_END,
  JOURNEY_RAIL_START,
} from './world';

const FORWARD = new THREE.Vector3(0, 0, 1);

function createFramingCamera(progress: number, aspect = 390 / 844, fov = 52) {
  const curve = createRailCurve();
  const railAmount = JOURNEY_RAIL_START
    + (JOURNEY_RAIL_END - JOURNEY_RAIL_START) * progress;
  const point = curve.getPointAt(railAmount);
  const tangent = curve.getTangentAt(railAmount).normalize();
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  const rig = calculateCameraRig(progress);
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.03, 180);
  camera.position.copy(point)
    .addScaledVector(normal, rig.lateral)
    .addScaledVector(tangent, rig.longitudinal);
  camera.position.y += rig.height;
  const target = point.clone().addScaledVector(tangent, rig.targetForward);
  if (rig.approachBlend > 0) {
    target.lerp(curve.getPointAt(BIRTHDAY_STATION_RAIL), rig.stationBlend);
  }
  target.addScaledVector(normal, rig.targetLateral);
  target.y += rig.targetHeight;
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  return { camera, curve, point, tangent };
}

function stationLocalPoint(
  curve: THREE.Curve<THREE.Vector3>,
  x: number,
  y: number,
  z: number,
): THREE.Vector3 {
  return tracksideLocalPoint(
    curve,
    BIRTHDAY_STATION_RAIL,
    ARRIVAL_SIGN_PLACEMENT.lateral,
    x,
    y,
    z,
  );
}

function tracksideLocalPoint(
  curve: THREE.Curve<THREE.Vector3>,
  railAmount: number,
  lateral: number,
  x: number,
  y: number,
  z: number,
): THREE.Vector3 {
  const point = curve.getPointAt(railAmount);
  const tangent = curve.getTangentAt(railAmount).normalize();
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  const root = point.clone().addScaledVector(normal, lateral);
  const rotation = new THREE.Quaternion().setFromUnitVectors(FORWARD, tangent);
  return new THREE.Vector3(x, y, z).applyQuaternion(rotation).add(root);
}

describe('calculateCameraRig', () => {
  it('発車・追走・駅接近の3構図を所定位置で作る', () => {
    expect(calculateCameraRig(0)).toMatchObject({
      lateral: 7.4,
      longitudinal: 3.7,
      targetForward: -1.35,
      stationBlend: 0,
    });
    const tracking = calculateCameraRig(0.4);
    expect(tracking.lateral).toBeCloseTo(6.5);
    expect(tracking.longitudinal).toBeCloseTo(5);
    expect(tracking.targetForward).toBeCloseTo(-1.2);
    expect(tracking.targetLateral).toBe(0);
    expect(tracking.stationBlend).toBe(0);
    expect(calculateCameraRig(0.8).stationBlend).toBe(0);
    const arrival = calculateCameraRig(1);
    expect(arrival.lateral).toBeCloseTo(8);
    expect(arrival.longitudinal).toBeCloseTo(7);
    expect(arrival.height).toBeCloseTo(2.8);
    expect(arrival.targetForward).toBeCloseTo(-1);
    expect(arrival.targetLateral).toBeCloseTo(-0.35);
    expect(arrival.stationBlend).toBeCloseTo(0.14);
    expect(arrival.targetHeight).toBeCloseTo(1.65);
  });

  it('全行程でカメラ値に瞬間的なジャンプがない', () => {
    let previous = calculateCameraRig(0);
    for (let index = 1; index <= 1000; index += 1) {
      const current = calculateCameraRig(index / 1000);
      expect(Math.abs(current.lateral - previous.lateral)).toBeLessThan(0.015);
      expect(Math.abs(current.longitudinal - previous.longitudinal)).toBeLessThan(0.045);
      expect(Math.abs(current.height - previous.height)).toBeLessThan(0.01);
      expect(Math.abs(current.targetForward - previous.targetForward)).toBeLessThan(0.02);
      expect(Math.abs(current.targetLateral - previous.targetLateral)).toBeLessThan(0.03);
      expect(Math.abs(current.targetHeight - previous.targetHeight)).toBeLessThan(0.01);
      expect(current.stationBlend).toBeGreaterThanOrEqual(previous.stationBlend);
      previous = current;
    }
  });

  it('撮影ブレンドは境界で速度と加速度が連続する', () => {
    const keys = ['departureBlend', 'approachBlend', 'stationBlend'] as const;
    const step = 1e-5;
    for (const boundary of [0.28, 0.58, 0.82]) {
      for (const key of keys) {
        const samples = [-2, -1, 0, 1, 2].map((offset) => (
          calculateCameraRig(boundary + offset * step)[key]
        ));
        const leftVelocity = (samples[2] - samples[1]) / step;
        const rightVelocity = (samples[3] - samples[2]) / step;
        const leftAcceleration = (samples[2] - 2 * samples[1] + samples[0]) / (step * step);
        const rightAcceleration = (samples[4] - 2 * samples[3] + samples[2]) / (step * step);
        expect(Math.abs(leftVelocity - rightVelocity)).toBeLessThan(0.001);
        expect(Math.abs(leftAcceleration - rightAcceleration)).toBeLessThan(0.1);
      }
    }
  });

  it('範囲外の進捗を安全に端点へ丸める', () => {
    expect(calculateCameraRig(-2)).toEqual(calculateCameraRig(0));
    expect(calculateCameraRig(8)).toEqual(calculateCameraRig(1));
  });
});

describe('3D route framing geometry', () => {
  it('15両編成の最後尾まで発車時の曲線内に収まる', () => {
    const curveLength = createRailCurve().getLength();
    const lastCarCentre = 14 * E235_DIMENSIONS.carPitch
      + E235_DIMENSIONS.carLength * 0.5
      + E235_DIMENSIONS.cabFaceOffset;
    expect(JOURNEY_RAIL_START - lastCarCentre / curveLength).toBeGreaterThan(0);
  });

  it('終点から駅名標まで、縦画面で同居できる接近距離にする', () => {
    const curveLength = createRailCurve().getLength();
    const approachDistance = (BIRTHDAY_STATION_RAIL - JOURNEY_RAIL_END) * curveLength;
    expect(approachDistance).toBeGreaterThan(3);
    expect(approachDistance).toBeLessThan(4.2);
  });

  it('390×844の最終画角に先頭車中心と駅名標中心を同時に収める', () => {
    const { camera, curve, point } = createFramingCamera(1);
    const leadCab = point.clone().add(new THREE.Vector3(0, 0.46, 0)).project(camera);
    const stationSign = stationLocalPoint(
      curve,
      ARRIVAL_SIGN_PLACEMENT.x,
      ARRIVAL_SIGN_PLACEMENT.y,
      ARRIVAL_SIGN_PLACEMENT.z,
    ).project(camera);
    // stationBuildingRoot=(1.1, 0, -0.8); use the camera-facing facade and its
    // trackside roof eave after applying that group transform. The ridge centre
    // intentionally extends beyond the portrait crop so the building feels large.
    const glassEntrance = stationLocalPoint(curve, -3.215, 1.02, 0.3).project(camera);
    const roofEave = stationLocalPoint(curve, -3.5, 2.33, 0.3).project(camera);

    // The final shot keeps the cab close to optical centre while the station
    // fills the opposite side of the portrait frame.
    expect(leadCab.x).toBeGreaterThan(-0.2);
    expect(leadCab.x).toBeLessThan(0.2);
    expect(Math.abs(stationSign.x)).toBeLessThan(0.5);
    expect(stationSign.y).toBeLessThan(0.2);
    expect(stationSign.y).toBeGreaterThan(-0.2);
    // The centre sits just outside portrait view while the wide sliding-door
    // leaves and frame remain visible along the right edge.
    expect(glassEntrance.x).toBeLessThan(1.1);
    expect(glassEntrance.x).toBeGreaterThan(0.8);
    expect(roofEave.x).toBeLessThan(0.99);
    expect(roofEave.y).toBeGreaterThan(-0.2);
  });

  it('発車標は縦画面で読める大きさに入り、列車の後方へ離れる', () => {
    const start = createFramingCamera(0);
    const placement = DEPARTURE_SIGN_PLACEMENT;
    const centre = tracksideLocalPoint(
      start.curve,
      JOURNEY_RAIL_START,
      placement.lateral,
      placement.x,
      placement.y,
      placement.z,
    ).project(start.camera);
    const left = tracksideLocalPoint(
      start.curve,
      JOURNEY_RAIL_START,
      placement.lateral,
      placement.x,
      placement.y,
      placement.z - 1.125 * placement.scale,
    ).project(start.camera);
    const right = tracksideLocalPoint(
      start.curve,
      JOURNEY_RAIL_START,
      placement.lateral,
      placement.x,
      placement.y,
      placement.z + 1.125 * placement.scale,
    ).project(start.camera);

    expect(centre.x).toBeGreaterThan(0.05);
    expect(centre.x).toBeLessThan(0.65);
    // The sign occupies the narrow horizon gap between the ready-state cards.
    expect(centre.y).toBeGreaterThan(0.35);
    expect(centre.y).toBeLessThan(0.55);
    // >110 px at 390 px viewport width, enough for the large day number.
    expect(Math.abs(right.x - left.x) * 195).toBeGreaterThan(110);

    const departed = createFramingCamera(0.08);
    const receding = tracksideLocalPoint(
      departed.curve,
      JOURNEY_RAIL_START,
      placement.lateral,
      placement.x,
      placement.y,
      placement.z,
    ).project(departed.camera);
    expect(receding.x).toBeLessThan(-1);
  });

  it('到着標は接近用反復標から駅舎前の最終標へ自然に受け継ぐ', () => {
    const approach = createFramingCamera(0.88);
    const advance = ARRIVAL_ADVANCE_SIGN_PLACEMENT;
    const advanceCentre = tracksideLocalPoint(
      approach.curve,
      ARRIVAL_ADVANCE_SIGN_RAIL,
      advance.lateral,
      advance.x,
      advance.y,
      advance.z,
    ).project(approach.camera);
    expect(Math.abs(advanceCentre.x)).toBeLessThan(0.65);
    expect(Math.abs(advanceCentre.y)).toBeLessThan(0.3);

    const arrival = createFramingCamera(1);
    const finalCentre = stationLocalPoint(
      arrival.curve,
      ARRIVAL_SIGN_PLACEMENT.x,
      ARRIVAL_SIGN_PLACEMENT.y,
      ARRIVAL_SIGN_PLACEMENT.z,
    ).project(arrival.camera);
    const leadCab = arrival.point.clone().add(new THREE.Vector3(0, 0.46, 0)).project(arrival.camera);
    expect(finalCentre.x).toBeGreaterThan(0.25);
    expect(finalCentre.x).toBeLessThan(0.65);
    expect(finalCentre.x - leadCab.x).toBeGreaterThan(0.25);
  });

  it('390×844の最終接近中も先頭面を画角から外さない', () => {
    const midpoint = createFramingCamera(0.55);
    const firstCarCentre = midpoint.point.clone().addScaledVector(
      midpoint.tangent,
      -(E235_DIMENSIONS.carLength * 0.5 + E235_DIMENSIONS.cabFaceOffset),
    ).project(midpoint.camera);
    const secondCarCentre = midpoint.point.clone().addScaledVector(
      midpoint.tangent,
      -(E235_DIMENSIONS.carLength * 0.5
        + E235_DIMENSIONS.cabFaceOffset
        + E235_DIMENSIONS.carPitch),
    ).project(midpoint.camera);
    expect(Math.abs(firstCarCentre.x)).toBeLessThan(0.45);
    expect(secondCarCentre.x).toBeGreaterThan(-0.95);
    expect(secondCarCentre.x).toBeLessThan(-0.55);

    const desktop = createFramingCamera(1, 1366 / 768, 42);
    const desktopEntrance = stationLocalPoint(
      desktop.curve,
      -3.215,
      1.02,
      0.3,
    ).project(desktop.camera);
    expect(Math.abs(desktopEntrance.x)).toBeLessThan(0.8);
    expect(Math.abs(desktopEntrance.y)).toBeLessThan(0.65);
  });
});
