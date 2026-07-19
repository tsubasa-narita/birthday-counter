const BIRTH_MONTH = 7; // JavaScript months start at 0: 7 = August
const BIRTH_DAY = 2;
const BIRTH_YEAR = 2023;
const timeZone = 'Asia/Tokyo';
const DAY_MS = 86400000;
const RIDE_STORAGE_KEY = 'birthday-train:last-ride-date';

const DAILY_STAMPS = [
  'ぞう 🐘', 'きりん 🦒', 'らいおん 🦁', 'ぱんだ 🐼', 'ぺんぎん 🐧', 'くじら 🐳', 'うさぎ 🐰',
  'こあら 🐨', 'おさる 🐵', 'かえる 🐸', 'かめ 🐢', 'ひよこ 🐥', 'たこ 🐙', 'おほしさま ⭐'
];

const TRAIN_TYPES = [
  {
    id: 'loop',
    name: 'みどりの わっかでんしゃ',
    message: 'ぐるっと はしって 1にち とどけたよ！',
    whistle: [523.25, 659.25]
  },
  {
    id: 'express',
    name: 'あかい びゅんびゅんとっきゅう',
    message: 'びゅーん！ きょうまで ひとっとび！',
    whistle: [587.33, 783.99]
  },
  {
    id: 'inspect',
    name: 'きいろの きらきらけんさでんしゃ',
    message: 'せんろを ぴかぴかにして とどけたよ！',
    whistle: [493.88, 739.99]
  }
];

const $ = (selector) => document.querySelector(selector);
const app = $('#app');
const journeyShow = $('#journeyShow');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let midnightTimer;
let audioContext;
let currentState;
let currentTrainIndex = -1;
let showTimers = [];
let isShowOpen = false;
let previewRevealedDate = null;
let activeTrainSound = null;

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

function dateKey({ year, month, day }) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isPreviewMode() {
  return Boolean(validPreviewDate(new URLSearchParams(location.search).get('date')));
}

function hasRiddenToday(today) {
  const params = new URLSearchParams(location.search);
  if (isPreviewMode()) return params.get('revealed') === '1' || previewRevealedDate === dateKey(today);
  try {
    return localStorage.getItem(RIDE_STORAGE_KEY) === dateKey(today);
  } catch {
    return false;
  }
}

function rememberTodayRide(today) {
  if (isPreviewMode()) {
    previewRevealedDate = dateKey(today);
    return;
  }
  try {
    localStorage.setItem(RIDE_STORAGE_KEY, dateKey(today));
  } catch {
    // The animation still works when storage is unavailable.
  }
}

function setProgress(value, daysUntil, animate = false) {
  const rounded = Math.round(value);
  const normalized = `${value}%`;
  const track = $('#track');
  if (animate) track.classList.add('is-advancing');
  $('#trackFill').style.width = normalized;
  $('#miniTrain').style.left = normalized;
  track.setAttribute('aria-valuenow', rounded);
  track.setAttribute('aria-valuetext', daysUntil === 0 ? 'お誕生日駅に到着' : `お誕生日駅まであと${daysUntil}駅`);
  if (animate) setTimeout(() => track.classList.remove('is-advancing'), 1400);
}

function getCountdownState() {
  const today = getJapanDate();
  const thisBirthday = { year: today.year, month: BIRTH_MONTH, day: BIRTH_DAY };
  const differenceThisYear = dayNumber(thisBirthday) - dayNumber(today);
  const targetYear = differenceThisYear < 0 ? today.year + 1 : today.year;
  const birthday = { year: targetYear, month: BIRTH_MONTH, day: BIRTH_DAY };
  const actualDays = dayNumber(birthday) - dayNumber(today);
  return {
    today,
    birthday,
    targetYear,
    actualDays,
    birthdayAge: targetYear - BIRTH_YEAR,
    revealed: hasRiddenToday(today)
  };
}

function renderCountdown({ animate = false } = {}) {
  const state = getCountdownState();
  currentState = state;

  const isBirthday = state.actualDays === 0;
  const isWaitingForRide = state.actualDays > 0 && !state.revealed;
  const displayDays = isWaitingForRide ? state.actualDays + 1 : state.actualDays;
  const todayDate = new Date(Date.UTC(state.today.year, state.today.month, state.today.day));
  const weekday = new Intl.DateTimeFormat('ja-JP', { weekday: 'short', timeZone: 'UTC' }).format(todayDate);
  const stamp = DAILY_STAMPS[Math.abs(dayNumber(state.today)) % DAILY_STAMPS.length];

  $('#todayLabel').textContent = `きょう ${state.today.month + 1}がつ${state.today.day}にち（${weekday}）`;
  $('#countdownDisplay').classList.toggle('is-birthday', isBirthday);
  $('#countdownDisplay').classList.toggle('is-long-count', displayDays >= 100);
  $('#countdownDisplay').classList.toggle('is-waiting', isWaitingForRide);
  $('.count-prefix').textContent = 'あと';
  $('.count-unit').textContent = 'にち';

  if (isBirthday) {
    $('#daysNumber').textContent = 'きょう！';
    $('#eyebrow').textContent = '8がつ2にち';
    $('#countdownTitle').innerHTML = `${state.birthdayAge}さいの おたんじょうび<br><span>おめでとう！</span>`;
    $('#routeRemaining').textContent = 'とうちゃく！';
    $('#journeyNote').textContent = 'おいわいれっしゃを はしらせよう！';
    $('#buttonLabel').textContent = 'おいわいれっしゃ 発車！';
  } else {
    $('#daysNumber').textContent = displayDays;
    $('#eyebrow').textContent = isWaitingForRide
      ? 'きのうの きっぷ'
      : (state.targetYear === state.today.year ? '8がつ2にちまで' : 'つぎの 8がつ2にちまで');
    $('#countdownTitle').innerHTML = isWaitingForRide
      ? `ボタンを おして<br><span>きょうへ しゅっぱつ！</span>`
      : `${state.birthdayAge}さいのおたんじょうびへ<br><span>きょうも 1えき すすんだよ！</span>`;
    $('#routeRemaining').textContent = `あと ${displayDays} えき`;
    $('#journeyNote').textContent = isWaitingForRide
      ? 'ボタンを おすと 1にち へるよ！'
      : `きょうの えきスタンプ：${stamp}`;
    $('#buttonLabel').textContent = isWaitingForRide ? '1にち はこぶ！' : 'もういちど はしる！';
  }

  const progress = isBirthday
    ? 100
    : displayDays > 32
      ? 2
      : Math.max(2, 4 + ((32 - displayDays) / 32) * 88);
  setProgress(progress, displayDays, animate);
}

function scheduleMidnightUpdate() {
  clearTimeout(midnightTimer);
  if (isPreviewMode()) return;
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

function getAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  audioContext ||= new AudioContext();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

function stopTrainSound() {
  if (!activeTrainSound || !audioContext) return;
  const now = audioContext.currentTime;
  const { master, sources } = activeTrainSound;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
  sources.forEach((source) => {
    try { source.stop(now + 0.05); } catch { /* already stopped */ }
  });
  activeTrainSound = null;
}

function playTrainSound(type) {
  const context = getAudioContext();
  if (!context) return;
  stopTrainSound();
  const now = context.currentTime;
  const sources = [];
  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.11, now + 0.04);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
  master.connect(context.destination);

  type.whistle.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type.id === 'express' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.04, now + 0.7);
    gain.gain.value = index ? 0.28 : 0.7;
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + 1.45);
    sources.push(oscillator);
  });

  for (let beat = 0; beat < 7; beat += 1) {
    const chug = context.createOscillator();
    const chugGain = context.createGain();
    const start = now + 0.18 + beat * 0.16;
    chug.type = 'triangle';
    chug.frequency.value = type.id === 'inspect' ? 125 : 92;
    chugGain.gain.setValueAtTime(0.0001, start);
    chugGain.gain.exponentialRampToValueAtTime(0.035, start + 0.015);
    chugGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);
    chug.connect(chugGain).connect(master);
    chug.start(start);
    chug.stop(start + 0.1);
    sources.push(chug);
  }
  activeTrainSound = { master, sources };
}

function playArrivalChime() {
  const context = getAudioContext();
  if (!context) return;
  const now = context.currentTime;
  [659.25, 783.99, 987.77].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + index * 0.12;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.08, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.45);
  });
}

function makeConfetti(amount = 24) {
  const container = $('#confetti');
  container.replaceChildren();
  const colors = ['#f8cd57', '#eb694e', '#087aa8', '#75b895', '#ffffff'];
  for (let index = 0; index < amount; index += 1) {
    const piece = document.createElement('i');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colors[index % colors.length];
    piece.style.setProperty('--duration', `${2.1 + Math.random() * 1.3}s`);
    piece.style.setProperty('--delay', `${Math.random() * .35}s`);
    piece.style.setProperty('--drift', `${-80 + Math.random() * 160}px`);
    piece.style.setProperty('--spin', `${360 + Math.random() * 720}deg`);
    container.appendChild(piece);
    setTimeout(() => piece.remove(), 4000);
  }
}

function clearShowTimers() {
  showTimers.forEach(clearTimeout);
  showTimers = [];
}

function createShowParticles(type) {
  const container = $('#showSparkles');
  container.replaceChildren();
  const symbols = type.id === 'inspect' ? ['✦', '✧', '★'] : type.id === 'express' ? ['◆', '●', '◆'] : ['●', '✦', '●'];
  for (let index = 0; index < 16; index += 1) {
    const particle = document.createElement('i');
    particle.textContent = symbols[index % symbols.length];
    particle.style.left = `${4 + Math.random() * 92}%`;
    particle.style.top = `${20 + Math.random() * 62}%`;
    particle.style.setProperty('--delay', `${Math.random() * 1.2}s`);
    particle.style.setProperty('--size', `${10 + Math.random() * 17}px`);
    container.appendChild(particle);
  }
}

function nextTrainType() {
  if (currentTrainIndex < 0) currentTrainIndex = Math.abs(dayNumber(currentState.today)) % TRAIN_TYPES.length;
  else currentTrainIndex = (currentTrainIndex + 1) % TRAIN_TYPES.length;
  return TRAIN_TYPES[currentTrainIndex];
}

function startJourney() {
  if (isShowOpen && !journeyShow.classList.contains('is-complete')) return;
  clearShowTimers();
  stopTrainSound();
  const rideState = {
    ...currentState,
    today: { ...currentState.today },
    birthday: { ...currentState.birthday }
  };
  const type = nextTrainType();
  const wasAlreadyRevealed = rideState.revealed;
  const beforeDays = rideState.actualDays > 0 ? rideState.actualDays + 1 : 0;
  const travelTime = prefersReducedMotion.matches ? 80 : (type.id === 'express' ? 2250 : type.id === 'inspect' ? 3100 : 2700);
  const completeTime = prefersReducedMotion.matches ? 160 : travelTime + 800;

  journeyShow.hidden = false;
  journeyShow.className = `journey-show scene--${type.id}`;
  journeyShow.dataset.train = type.id;
  const arrivalCard = $('#arrivalCard');
  const arrivalButtons = [$('#replayButton'), $('#returnButton')];
  arrivalCard.hidden = true;
  arrivalCard.setAttribute('aria-hidden', 'true');
  arrivalCard.setAttribute('inert', '');
  arrivalButtons.forEach((button) => { button.disabled = true; });
  $('#showTitle').textContent = type.name;
  $('#showCountLabel').textContent = wasAlreadyRevealed ? '1にち まえは あと' : 'きのうは あと';
  $('#showDaysNumber').textContent = rideState.actualDays === 0 ? '🎂' : beforeDays;
  $('#showCountUnit').hidden = rideState.actualDays === 0;
  $('#arrivalDays').textContent = rideState.actualDays === 0 ? '🎂' : rideState.actualDays;
  $('#arrivalMessage').textContent = rideState.actualDays === 0 ? 'おたんじょうび おめでとう！' : type.message;
  arrivalCard.classList.toggle('is-birthday', rideState.actualDays === 0);
  createShowParticles(type);
  document.body.classList.add('show-is-open');
  app.setAttribute('inert', '');
  isShowOpen = true;

  requestAnimationFrame(() => {
    journeyShow.classList.add('is-playing');
    $('#showClose').focus({ preventScroll: true });
    playTrainSound(type);
  });

  showTimers.push(setTimeout(() => {
    journeyShow.classList.add('has-arrived');
    $('#showCountLabel').textContent = rideState.actualDays === 0 ? 'きょうは' : 'きょうは あと';
    $('#showDaysNumber').textContent = rideState.actualDays === 0 ? 'おたんじょうび！' : rideState.actualDays;
    $('#showCountUnit').hidden = rideState.actualDays === 0;
    rememberTodayRide(rideState.today);
    renderCountdown({ animate: true });
    playArrivalChime();
    makeConfetti(rideState.actualDays === 0 ? 50 : 32);
  }, travelTime));

  showTimers.push(setTimeout(() => {
    arrivalCard.hidden = false;
    arrivalCard.setAttribute('aria-hidden', 'false');
    arrivalCard.removeAttribute('inert');
    arrivalButtons.forEach((button) => { button.disabled = false; });
    requestAnimationFrame(() => {
      if (!isShowOpen) return;
      journeyShow.classList.add('is-complete');
      $('#returnButton').focus({ preventScroll: true });
    });
  }, completeTime));
}

function closeJourney() {
  clearShowTimers();
  stopTrainSound();
  journeyShow.hidden = true;
  journeyShow.className = 'journey-show';
  document.body.classList.remove('show-is-open');
  app.removeAttribute('inert');
  isShowOpen = false;
  $('#departButton').focus({ preventScroll: true });
}

$('#departButton').addEventListener('click', startJourney);
$('#replayButton').addEventListener('click', startJourney);
$('#returnButton').addEventListener('click', closeJourney);
$('#showClose').addEventListener('click', closeJourney);

document.addEventListener('keydown', (event) => {
  if (!isShowOpen) return;
  if (event.key === 'Escape') {
    closeJourney();
    return;
  }
  if (event.key === 'Tab') {
    const focusable = journeyShow.classList.contains('is-complete')
      ? [$('#showClose'), $('#replayButton'), $('#returnButton')]
      : [$('#showClose')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (focusable.length === 1 || (event.shiftKey && document.activeElement === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    renderCountdown();
    scheduleMidnightUpdate();
  }
});

renderCountdown();
scheduleMidnightUpdate();
if (currentState.actualDays === 0) setTimeout(() => makeConfetti(28), 500);
