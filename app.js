const BIRTH_MONTH = 7; // JavaScript months start at 0: 7 = August
const BIRTH_DAY = 2;
const BIRTH_YEAR = 2023;
const JOURNEY_START_MONTH = 6; // July
const JOURNEY_START_DAY = 1;
const timeZone = 'Asia/Tokyo';
const DAY_MS = 86400000;
const DAILY_STAMPS = [
  'ぞう 🐘', 'きりん 🦒', 'らいおん 🦁', 'ぱんだ 🐼', 'ぺんぎん 🐧', 'くじら 🐳', 'うさぎ 🐰',
  'こあら 🐨', 'おさる 🐵', 'かえる 🐸', 'かめ 🐢', 'ひよこ 🐥', 'たこ 🐙', 'おほしさま ⭐'
];

const $ = (selector) => document.querySelector(selector);
const app = $('#app');
let midnightTimer;
let audioContext;
let lastWhistleAt = 0;

function validPreviewDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, monthNumber, day] = value.split('-').map(Number);
  const candidate = new Date(Date.UTC(year, monthNumber - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== monthNumber - 1 ||
    candidate.getUTCDate() !== day
  ) return null;
  return { year, month: monthNumber - 1, day };
}

function getJapanDate() {
  const preview = validPreviewDate(new URLSearchParams(location.search).get('date'));
  if (preview) return preview;

  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(new Date());
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: value('year'), month: value('month') - 1, day: value('day') };
}

function dayNumber({ year, month, day }) {
  return Date.UTC(year, month, day) / DAY_MS;
}

function setProgress(value, daysUntil) {
  const rounded = Math.round(value);
  const normalized = `${value}%`;
  $('#trackFill').style.width = normalized;
  $('#miniTrain').style.left = normalized;
  $('#track').setAttribute('aria-valuenow', rounded);
  $('#track').setAttribute('aria-valuetext', daysUntil === 0 ? 'お誕生日に到着' : `お誕生日まであと${daysUntil}日`);
}

function renderCountdown() {
  const today = getJapanDate();
  const thisBirthday = { year: today.year, month: BIRTH_MONTH, day: BIRTH_DAY };
  const differenceThisYear = dayNumber(thisBirthday) - dayNumber(today);
  const targetYear = differenceThisYear < 0 ? today.year + 1 : today.year;
  const birthday = { year: targetYear, month: BIRTH_MONTH, day: BIRTH_DAY };
  const daysUntil = dayNumber(birthday) - dayNumber(today);
  const birthdayAge = targetYear - BIRTH_YEAR;
  const todayDate = new Date(Date.UTC(today.year, today.month, today.day));
  const weekday = new Intl.DateTimeFormat('ja-JP', { weekday: 'short', timeZone: 'UTC' }).format(todayDate);

  $('#todayLabel').textContent = `きょう ${today.month + 1}がつ${today.day}にち（${weekday}）`;
  $('#countdownDisplay').classList.toggle('is-birthday', daysUntil === 0);
  $('#countdownDisplay').classList.toggle('is-long-count', daysUntil >= 100);
  $('.count-prefix').textContent = 'あと';
  $('.count-unit').textContent = 'にち';

  if (daysUntil > 0) {
    $('#daysNumber').textContent = daysUntil;
    $('#eyebrow').textContent = targetYear === today.year ? '8がつ2にちまで' : 'つぎの 8がつ2にちまで';
    $('#countdownTitle').innerHTML = `${birthdayAge}さいのおたんじょうびへ<br><span>しゅっぱつ しんこう！</span>`;
    const stamp = DAILY_STAMPS[Math.abs(dayNumber(today)) % DAILY_STAMPS.length];
    $('#journeyNote').textContent = `きょうの えきスタンプ：${stamp}`;
    $('#buttonLabel').textContent = 'きてきを ならす';
    const journeyStart = { year: targetYear, month: JOURNEY_START_MONTH, day: JOURNEY_START_DAY };
    const total = dayNumber(birthday) - dayNumber(journeyStart);
    const traveled = Math.max(0, dayNumber(today) - dayNumber(journeyStart));
    const progress = Math.min(94, Math.max(4, (traveled / total) * 100));
    setProgress(progress, daysUntil);
  } else {
    $('#daysNumber').textContent = 'きょう！';
    $('#eyebrow').textContent = '8がつ2にち';
    $('#countdownTitle').innerHTML = `${birthdayAge}さいの おたんじょうび<br><span>おめでとう！</span>`;
    $('#journeyNote').textContent = 'たんじょうびえきに とうちゃく！';
    $('#buttonLabel').textContent = 'おいわいの きてき！';
    setProgress(100, 0);
  }
}

function scheduleMidnightUpdate() {
  clearTimeout(midnightTimer);
  if (validPreviewDate(new URLSearchParams(location.search).get('date'))) return;
  const now = new Date();
  const japanNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const nextMidnight = Date.UTC(
    japanNow.getUTCFullYear(),
    japanNow.getUTCMonth(),
    japanNow.getUTCDate() + 1
  ) - 9 * 60 * 60 * 1000;
  midnightTimer = setTimeout(() => {
    renderCountdown();
    scheduleMidnightUpdate();
  }, Math.max(1000, nextMidnight - now.getTime() + 250));
}

function playWhistle() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  audioContext ||= new AudioContext();
  if (audioContext.state === 'suspended') audioContext.resume();
  const now = audioContext.currentTime;
  const master = audioContext.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.13, now + 0.04);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
  master.connect(audioContext.destination);

  [523.25, 659.25].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.055, now + 0.45);
    gain.gain.value = index ? 0.35 : 0.75;
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + 0.9);
  });
}

function makeConfetti(amount = 18) {
  const container = $('#confetti');
  container.replaceChildren();
  const colors = ['#f8cd57', '#eb694e', '#087aa8', '#75b895', '#ffffff'];
  for (let index = 0; index < amount; index += 1) {
    const piece = document.createElement('i');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colors[index % colors.length];
    piece.style.setProperty('--duration', `${2.1 + Math.random() * 1.3}s`);
    piece.style.setProperty('--delay', `${Math.random() * .4}s`);
    piece.style.setProperty('--drift', `${-80 + Math.random() * 160}px`);
    piece.style.setProperty('--spin', `${360 + Math.random() * 720}deg`);
    container.appendChild(piece);
    setTimeout(() => piece.remove(), 4000);
  }
}

$('#departButton').addEventListener('click', () => {
  const now = Date.now();
  if (now - lastWhistleAt < 800) return;
  lastWhistleAt = now;
  playWhistle();
  makeConfetti();
  app.classList.remove('toot');
  requestAnimationFrame(() => app.classList.add('toot'));
  setTimeout(() => app.classList.remove('toot'), 800);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    renderCountdown();
    scheduleMidnightUpdate();
  }
});

renderCountdown();
scheduleMidnightUpdate();
if (dayNumber(getJapanDate()) === dayNumber({ year: getJapanDate().year, month: BIRTH_MONTH, day: BIRTH_DAY })) {
  setTimeout(() => makeConfetti(28), 500);
}
