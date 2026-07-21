import { describe, expect, it } from 'vitest';
import { calculateCameraRig } from './cameraRig';
import { E235_DIMENSIONS } from './e235';
import {
  BIRTHDAY_STATION_RAIL,
  createRailCurve,
  JOURNEY_RAIL_END,
  JOURNEY_RAIL_START,
} from './world';

describe('calculateCameraRig', () => {
  it('発車・追走・駅接近の3構図を所定位置で作る', () => {
    expect(calculateCameraRig(0)).toMatchObject({
      lateral: 7.4,
      longitudinal: 3.7,
      targetForward: -1.35,
      stationBlend: 0,
    });
    const tracking = calculateCameraRig(0.4);
    expect(tracking.lateral).toBeCloseTo(8.15);
    expect(tracking.longitudinal).toBeCloseTo(-1.2);
    expect(tracking.targetForward).toBeCloseTo(0.35);
    expect(tracking.stationBlend).toBe(0);
    expect(calculateCameraRig(0.8).stationBlend).toBe(0);
    const arrival = calculateCameraRig(1);
    expect(arrival.lateral).toBeCloseTo(7.7);
    expect(arrival.longitudinal).toBeCloseTo(3.2);
    expect(arrival.height).toBeCloseTo(3.05);
    expect(arrival.targetForward).toBeCloseTo(-0.55);
    expect(arrival.stationBlend).toBeCloseTo(0.25);
    expect(arrival.targetHeight).toBeCloseTo(1.42);
  });

  it('全行程でカメラ値に瞬間的なジャンプがない', () => {
    let previous = calculateCameraRig(0);
    for (let index = 1; index <= 1000; index += 1) {
      const current = calculateCameraRig(index / 1000);
      expect(Math.abs(current.lateral - previous.lateral)).toBeLessThan(0.015);
      expect(Math.abs(current.longitudinal - previous.longitudinal)).toBeLessThan(0.03);
      expect(Math.abs(current.height - previous.height)).toBeLessThan(0.01);
      expect(Math.abs(current.targetForward - previous.targetForward)).toBeLessThan(0.02);
      expect(Math.abs(current.targetHeight - previous.targetHeight)).toBeLessThan(0.01);
      expect(current.stationBlend).toBeGreaterThanOrEqual(previous.stationBlend);
      previous = current;
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
    const curveLength = createRailCurve().getLength();
    const stationDistance = (BIRTHDAY_STATION_RAIL - JOURNEY_RAIL_END) * curveLength;
    const rig = calculateCameraRig(1);
    const opticalTarget = rig.targetForward
      + (stationDistance - rig.targetForward) * rig.stationBlend;
    const leadCarCentre = -(E235_DIMENSIONS.carLength * 0.5 + E235_DIMENSIONS.cabFaceOffset);
    const stationSignCentre = stationDistance - 3.1;
    const stationSignHalfWidth = 2.25 / 2;
    const portraitAspect = 390 / 844;
    const halfHorizontalSpan = rig.lateral * Math.tan(52 * Math.PI / 360) * portraitAspect;

    expect(Math.abs(leadCarCentre - opticalTarget)).toBeLessThan(halfHorizontalSpan);
    expect(Math.abs(stationSignCentre - opticalTarget)).toBeLessThan(halfHorizontalSpan);
    expect(stationSignCentre - stationSignHalfWidth).toBeGreaterThan(opticalTarget - halfHorizontalSpan);
    expect(stationSignCentre + stationSignHalfWidth).toBeLessThan(opticalTarget + halfHorizontalSpan);
  });

  it('390×844の最終接近中も先頭面を画角から外さない', () => {
    const curveLength = createRailCurve().getLength();
    const portraitAspect = 390 / 844;

    for (const progress of [0.8, 0.9, 0.95, 1]) {
      const railAmount = JOURNEY_RAIL_START
        + (JOURNEY_RAIL_END - JOURNEY_RAIL_START) * progress;
      const stationDistance = (BIRTHDAY_STATION_RAIL - railAmount) * curveLength;
      const rig = calculateCameraRig(progress);
      const opticalTarget = rig.targetForward
        + (stationDistance - rig.targetForward) * rig.stationBlend;
      const halfHorizontalSpan = rig.lateral * Math.tan(52 * Math.PI / 360) * portraitAspect;

      // The rail point is the leading cab face (the first car centre sits
      // behind it), so zero must remain inside the horizontal portrait view.
      expect(Math.abs(opticalTarget)).toBeLessThan(halfHorizontalSpan);
    }
  });
});
