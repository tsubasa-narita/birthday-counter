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
    const arrival = calculateCameraRig(1);
    expect(arrival.lateral).toBeCloseTo(9.35);
    expect(arrival.longitudinal).toBeCloseTo(0.35);
    expect(arrival.height).toBeCloseTo(3.35);
    expect(arrival.stationBlend).toBeCloseTo(0.52);
  });

  it('全行程でカメラ値に瞬間的なジャンプがない', () => {
    let previous = calculateCameraRig(0);
    for (let index = 1; index <= 1000; index += 1) {
      const current = calculateCameraRig(index / 1000);
      expect(Math.abs(current.lateral - previous.lateral)).toBeLessThan(0.015);
      expect(Math.abs(current.longitudinal - previous.longitudinal)).toBeLessThan(0.03);
      expect(Math.abs(current.targetForward - previous.targetForward)).toBeLessThan(0.02);
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
});
