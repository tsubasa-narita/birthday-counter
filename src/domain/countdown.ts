export interface PlainDate {
  year: number;
  month: number;
  day: number;
}

export interface CountdownState {
  today: PlainDate;
  birthday: PlainDate;
  targetYear: number;
  actualDays: number;
  birthdayAge: number;
  isBirthday: boolean;
}

export interface RideMemory {
  riddenDate: string;
  stationDays: number;
  targetYear: number;
}

export interface RidePlan {
  fromDays: number;
  toDays: number;
  passedStations: number[];
  isReplay: boolean;
  isCatchUp: boolean;
}

const BIRTH_MONTH = 8;
const BIRTH_DAY = 2;
const BIRTH_YEAR = 2023;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const japanDateFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric'
});

function utcDay(date: PlainDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

function isValidDate(date: PlainDate): boolean {
  if (!Number.isInteger(date.year) || !Number.isInteger(date.month) || !Number.isInteger(date.day)) {
    return false;
  }

  const timestamp = utcDay(date);
  const normalized = new Date(timestamp);

  return normalized.getUTCFullYear() === date.year
    && normalized.getUTCMonth() + 1 === date.month
    && normalized.getUTCDate() === date.day;
}

function parseDateKey(value: string): PlainDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const date: PlainDate = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };

  return isValidDate(date) ? date : null;
}

function isRideMemory(value: unknown): value is RideMemory {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return typeof candidate.riddenDate === 'string'
    && parseDateKey(candidate.riddenDate) !== null
    && typeof candidate.stationDays === 'number'
    && Number.isSafeInteger(candidate.stationDays)
    && candidate.stationDays >= 0
    && candidate.stationDays <= 366
    && typeof candidate.targetYear === 'number'
    && Number.isSafeInteger(candidate.targetYear)
    && candidate.targetYear >= BIRTH_YEAR
    && candidate.targetYear <= 9999;
}

export function japanDateFromInstant(now: Date = new Date()): PlainDate {
  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;

  for (const part of japanDateFormatter.formatToParts(now)) {
    if (part.type === 'year') {
      year = Number(part.value);
    } else if (part.type === 'month') {
      month = Number(part.value);
    } else if (part.type === 'day') {
      day = Number(part.value);
    }
  }

  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('日本時間の日付を取得できませんでした。');
  }

  return { year, month, day };
}

export function dateKey(date: PlainDate): string {
  const year = String(date.year).padStart(4, '0');
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calculateCountdown(today: PlainDate): CountdownState {
  const thisYearsBirthday: PlainDate = {
    year: today.year,
    month: BIRTH_MONTH,
    day: BIRTH_DAY
  };
  const isAfterThisYearsBirthday = utcDay(today) > utcDay(thisYearsBirthday);
  const targetYear = isAfterThisYearsBirthday ? today.year + 1 : today.year;
  const birthday: PlainDate = {
    year: targetYear,
    month: BIRTH_MONTH,
    day: BIRTH_DAY
  };
  const actualDays = Math.round((utcDay(birthday) - utcDay(today)) / MILLISECONDS_PER_DAY);

  return {
    today,
    birthday,
    targetYear,
    actualDays,
    birthdayAge: targetYear - BIRTH_YEAR,
    isBirthday: today.month === BIRTH_MONTH && today.day === BIRTH_DAY
  };
}

export function createRidePlan(state: CountdownState, memory?: RideMemory | null): RidePlan {
  const defaultPlan: RidePlan = {
    fromDays: state.actualDays + 1,
    toDays: state.actualDays,
    passedStations: [],
    isReplay: false,
    isCatchUp: false
  };

  if (!isRideMemory(memory) || memory.targetYear !== state.targetYear) {
    return defaultPlan;
  }

  const todayKey = dateKey(state.today);
  if (memory.riddenDate === todayKey) {
    return { ...defaultPlan, isReplay: true };
  }

  if (memory.riddenDate > todayKey || memory.stationDays <= state.actualDays) {
    return defaultPlan;
  }

  const fromDays = memory.stationDays;
  const gap = fromDays - state.actualDays;
  const passedStations: number[] = [];

  for (let station = fromDays - 1; station > state.actualDays && passedStations.length < 3; station -= 1) {
    passedStations.push(station);
  }

  return {
    fromDays,
    toDays: state.actualDays,
    passedStations,
    isReplay: false,
    isCatchUp: gap > 1
  };
}

export function memoryAfterArrival(state: CountdownState): RideMemory {
  return {
    riddenDate: dateKey(state.today),
    stationDays: state.actualDays,
    targetYear: state.targetYear
  };
}

export function parseRideMemory(raw: string | null): RideMemory | null {
  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return isRideMemory(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function serializeRideMemory(memory: RideMemory): string {
  return JSON.stringify(memory);
}

export function stationLabel(days: number): string {
  return days === 0 ? 'たんじょうびえき' : `あと${days}にちえき`;
}
