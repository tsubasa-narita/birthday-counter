import { describe, expect, it } from 'vitest';
import {
  calculateCountdown,
  createRidePlan,
  dateKey,
  japanDateFromInstant,
  memoryAfterArrival,
  parseRideMemory,
  serializeRideMemory,
  stationLabel,
  type CountdownState,
  type PlainDate,
  type RideMemory
} from './countdown';

const july21: PlainDate = { year: 2026, month: 7, day: 21 };

function stateOn(date: PlainDate): CountdownState {
  return calculateCountdown(date);
}

describe('japanDateFromInstant', () => {
  it('UTCでは前日でも日本時間の日付を返す', () => {
    expect(japanDateFromInstant(new Date('2026-08-01T15:00:00.000Z'))).toEqual({
      year: 2026,
      month: 8,
      day: 2
    });
  });
});

describe('dateKey', () => {
  it('年月日をゼロ埋めしたキーへ変換する', () => {
    expect(dateKey({ year: 2026, month: 8, day: 2 })).toBe('2026-08-02');
  });
});

describe('calculateCountdown', () => {
  it('2026年7月21日は3歳の誕生日まで12日', () => {
    expect(stateOn(july21)).toMatchObject({
      birthday: { year: 2026, month: 8, day: 2 },
      targetYear: 2026,
      actualDays: 12,
      birthdayAge: 3,
      isBirthday: false
    });
  });

  it('2026年8月1日は残り1日', () => {
    expect(stateOn({ year: 2026, month: 8, day: 1 }).actualDays).toBe(1);
  });

  it('2026年8月2日は残り0日で3歳の誕生日', () => {
    expect(stateOn({ year: 2026, month: 8, day: 2 })).toMatchObject({
      actualDays: 0,
      birthdayAge: 3,
      isBirthday: true,
      targetYear: 2026
    });
  });

  it('2026年8月3日は翌年の4歳の誕生日まで364日', () => {
    expect(stateOn({ year: 2026, month: 8, day: 3 })).toMatchObject({
      birthday: { year: 2027, month: 8, day: 2 },
      targetYear: 2027,
      actualDays: 364,
      birthdayAge: 4,
      isBirthday: false
    });
  });

  it('うるう日の2024年2月29日から誕生日まで155日', () => {
    expect(stateOn({ year: 2024, month: 2, day: 29 }).actualDays).toBe(155);
  });

  it('うるう年をまたぐ2023年8月3日から次の誕生日まで365日', () => {
    expect(stateOn({ year: 2023, month: 8, day: 3 }).actualDays).toBe(365);
  });
});

describe('createRidePlan', () => {
  const state = stateOn(july21);

  it('初回は昨日の残り日数駅から今日の駅へ進む', () => {
    expect(createRidePlan(state)).toEqual({
      fromDays: 13,
      toDays: 12,
      passedStations: [],
      isReplay: false,
      isCatchUp: false
    });
  });

  it('当日の再乗車は同じ1区間をリプレイする', () => {
    expect(createRidePlan(state, {
      riddenDate: '2026-07-21',
      stationDays: 12,
      targetYear: 2026
    })).toEqual({
      fromDays: 13,
      toDays: 12,
      passedStations: [],
      isReplay: true,
      isCatchUp: false
    });
  });

  it('前日からの1日分は通常運転になり途中駅を持たない', () => {
    expect(createRidePlan(state, {
      riddenDate: '2026-07-20',
      stationDays: 13,
      targetYear: 2026
    })).toEqual({
      fromDays: 13,
      toDays: 12,
      passedStations: [],
      isReplay: false,
      isCatchUp: false
    });
  });

  it('5日ぶりは最大3件の途中駅を通過する追いつき運転になる', () => {
    expect(createRidePlan(state, {
      riddenDate: '2026-07-16',
      stationDays: 17,
      targetYear: 2026
    })).toEqual({
      fromDays: 17,
      toDays: 12,
      passedStations: [16, 15, 14],
      isReplay: false,
      isCatchUp: true
    });
  });

  it('対象年が違う記録は利用せず安全な1区間に戻す', () => {
    expect(createRidePlan(state, {
      riddenDate: '2025-07-21',
      stationDays: 12,
      targetYear: 2025
    })).toEqual({
      fromDays: 13,
      toDays: 12,
      passedStations: [],
      isReplay: false,
      isCatchUp: false
    });
  });

  it('未来日や日数の逆行を示す記録は利用しない', () => {
    const futureMemory: RideMemory = {
      riddenDate: '2026-07-22',
      stationDays: 13,
      targetYear: 2026
    };
    const reversedMemory: RideMemory = {
      riddenDate: '2026-07-20',
      stationDays: 11,
      targetYear: 2026
    };

    expect(createRidePlan(state, futureMemory).fromDays).toBe(13);
    expect(createRidePlan(state, reversedMemory).fromDays).toBe(13);
  });

  it('誕生日当日は1日駅から誕生日駅へ進む', () => {
    expect(createRidePlan(stateOn({ year: 2026, month: 8, day: 2 }))).toMatchObject({
      fromDays: 1,
      toDays: 0
    });
  });
});

describe('ride memory', () => {
  it('到着後の記録を今日の日付・残り日数・対象年で作る', () => {
    expect(memoryAfterArrival(stateOn(july21))).toEqual({
      riddenDate: '2026-07-21',
      stationDays: 12,
      targetYear: 2026
    });
  });

  it('記録をJSONで往復できる', () => {
    const memory: RideMemory = {
      riddenDate: '2026-07-21',
      stationDays: 12,
      targetYear: 2026
    };

    expect(parseRideMemory(serializeRideMemory(memory))).toEqual(memory);
  });

  it('不正JSONと不正な値をnullへ戻す', () => {
    expect(parseRideMemory('{not-json')).toBeNull();
    expect(parseRideMemory('{"riddenDate":"2026-02-30","stationDays":12,"targetYear":2026}')).toBeNull();
    expect(parseRideMemory('{"riddenDate":"2026-07-21","stationDays":-1,"targetYear":2026}')).toBeNull();
    expect(parseRideMemory(null)).toBeNull();
  });
});

describe('stationLabel', () => {
  it('0日は誕生日駅になる', () => {
    expect(stationLabel(0)).toBe('たんじょうびえき');
  });

  it('残り日数の駅名を作る', () => {
    expect(stationLabel(9)).toBe('あと9にちえき');
  });
});
