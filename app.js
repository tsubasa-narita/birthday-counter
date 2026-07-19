const BIRTH_MONTH = 7; // JavaScript months start at 0: 7 = August
const BIRTH_DAY = 2;
const JOURNEY_START_MONTH = 6; // July
const JOURNEY_START_DAY = 1;
const timeZone = 'Asia/Tokyo';

const $ = (selector) => document.querySelector(selector);
const app = $('#app');

function getJapanDate() {
  const preview = new URLSearchParams(location.search).get('date');
  if (preview && /^\d{4}-\d{2}-\d{2}$/.test(preview)) {
    const [year, month, day] = preview.split('-').map(Number);
    return { year, month: month - 1, day };
  }

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
  return Date.UTC(year, month, day) / 86400000;
}

function renderCountdown() {
  const today = getJapanDate();
  const birthday = { year: today.year, month: BIRTH_MONTH, day: BIRTH_DAY };
  const difference = dayNumber(birthday) - dayNumber(today);
  const todayDate = new Date(Date.UTC(today.year, today.month, today.day));
  const weekday = new Intl.DateTimeFormat('ja-JP', { weekday: 'short', timeZone: 'UTC' }).format(todayDate);
  $('#todayLabel').textContent = `きょう ${today.month + 1}がつ${today.day}にち（${weekday}）`;

  if (difference > 0) {
    $('#daysNumber').textContent = difference;
    $('#eyebrow').textContent = '8がつ2にちまで';
    $('#countdownTitle').innerHTML = '3さいのおたんじょうびへ<br><span>しゅっぱつ しんこう！</span>';
    const journeyStart = { year: today.year, month: JOURNEY_START_MONTH, day: JOURNEY_START_DAY };
    const total = dayNumber(birthday) - dayNumber(journeyStart);
    const traveled = Math.max(0, dayNumber(today) - dayNumber(journeyStart));
    const progress = Math.min(94, Math.max(4, (traveled / total) * 100));
    setProgress(progress);
  } else if (difference === 0) {
    $('#countdownDisplay').innerHTML = '<span class="count-number" aria-label="きょう">きょう！</span>';
    $('#eyebrow').textContent = '8がつ2にち';
    $('#countdownTitle').innerHTML = '3さいの おたんじょうび<br><span>おめでとう！</span>';
    $('#journeyNote').textContent = 'たんじょうびえきに とうちゃく！';
    $('#buttonLabel').textContent = 'おいわいの きてき！';
    setProgress(100);
    setTimeout(() => makeConfetti(28), 500);
  } else {
    const nextBirthday = { year: today.year + 1, month: BIRTH_MONTH, day: BIRTH_DAY };
    const untilNext = dayNumber(nextBirthday) - dayNumber(today);
    $('#daysNumber').textContent = untilNext;
    $('#eyebrow').textContent = 'つぎの 8がつ2にちまで';
    $('#countdownTitle').innerHTML = 'つぎのおたんじょうびへ<br><span>また しゅっぱつ！</span>';
    $('#journeyNote').textContent = 'また すてきな いちねんを はしろう！';
    setProgress(4);
  }
}

function setProgress(value) {
  const normalized = `${value}%`;
  $('#trackFill').style.width = normalized;
  $('#miniTrain').style.left = normalized;
}

function playWhistle() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, context.currentTime);
  master.gain.exponentialRampToValueAtTime(0.13, context.currentTime + 0.04);
  master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.85);
  master.connect(context.destination);

  [523.25, 659.25].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.055, context.currentTime + 0.45);
    gain.gain.value = index ? 0.35 : 0.75;
    oscillator.connect(gain).connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.9);
  });
  setTimeout(() => context.close(), 1100);
}

function makeConfetti(amount = 18) {
  const container = $('#confetti');
  const colors = ['#f8cd57', '#eb694e', '#1497c5', '#75b895', '#ffffff'];
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
  playWhistle();
  makeConfetti();
  app.classList.remove('toot');
  requestAnimationFrame(() => app.classList.add('toot'));
  setTimeout(() => app.classList.remove('toot'), 800);
});

renderCountdown();
