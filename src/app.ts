import { gsap } from 'gsap';
import './style.css';
import { JourneyAudio } from './audio';
import {
  calculateCountdown,
  createRidePlan,
  dateKey,
  japanDateFromInstant,
  memoryAfterArrival,
  parseRideMemory,
  serializeRideMemory,
  stationLabel,
  type PlainDate,
  type RidePlan,
} from './domain/countdown';
import { createE235Formation, type TrainQuality } from './scene/e235';
import { RailwayWorld } from './scene/world';

const RIDE_KEY = 'birthday-e235:ride-v5';
const SOUND_KEY = 'birthday-e235:sound-v5';
const query = new URLSearchParams(window.location.search);

type ExperienceState = 'ready' | 'running' | 'arriving' | 'arrived';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`必要な画面部品がありません: ${selector}`);
  return element;
}

function parsePreviewDate(): PlainDate | null {
  const raw = query.get('date');
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const candidate: PlainDate = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const normalized = new Date(Date.UTC(candidate.year, candidate.month - 1, candidate.day));
  return normalized.getUTCFullYear() === candidate.year
    && normalized.getUTCMonth() + 1 === candidate.month
    && normalized.getUTCDate() === candidate.day
    ? candidate
    : null;
}

function safeStorageGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function safeStorageSet(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* The journey works without persistence. */ }
}

function chooseQuality(): { quality: TrainQuality; carCount: 4 | 11 | 15 } {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  const memory = navigatorWithMemory.deviceMemory ?? 4;
  const pixels = window.innerWidth * window.innerHeight * Math.min(window.devicePixelRatio || 1, 2);
  if (memory <= 2 || pixels > 4_500_000) return { quality: 'low', carCount: 4 };
  if (window.innerWidth < 700) return { quality: 'balanced', carCount: 4 };
  if (window.innerWidth >= 980 && memory >= 6) return { quality: 'high', carCount: 15 };
  return { quality: 'balanced', carCount: 11 };
}

function proximityMessage(days: number): string {
  if (days === 0) return 'ついに たんじょうびえきへ！';
  if (days <= 3) return 'ホームの かざりが みえるよ';
  if (days <= 7) return 'たんじょうびえきが すぐそこ！';
  if (days <= 14) return 'たんじょうびえきが みえてきたよ';
  if (days <= 30) return 'おいわいの ひかりが ちかづくよ';
  return 'ながい せんろを ゆっくり すすもう';
}

const app = required<HTMLElement>('#app');
const experience = required<HTMLElement>('#experience');
const topbar = required<HTMLElement>('.topbar');
const canvas = required<HTMLCanvasElement>('#sceneCanvas');
const departButton = required<HTMLButtonElement>('#departButton');
const replayButton = required<HTMLButtonElement>('#replayButton');
const restButton = required<HTMLButtonElement>('#restButton');
const arrivalPanel = required<HTMLElement>('#arrivalPanel');
const fallback = required<HTMLElement>('#webglFallback');
const soundToggle = required<HTMLButtonElement>('#soundToggle');
const stationKicker = required<HTMLElement>('#stationKicker');
const stationPrefix = required<HTMLElement>('#stationPrefix');
const stationDays = required<HTMLElement>('#stationDays');
const stationUnit = required<HTMLElement>('#stationUnit');
const todayMeta = required<HTMLElement>('#todayMeta');
const destinationName = required<HTMLElement>('#destinationName');
const proximity = required<HTMLElement>('#proximityMessage');
const journeyFill = required<HTMLElement>('#journeyFill');
const journeyTrainIcon = required<HTMLElement>('#journeyTrainIcon');
const stationPass = required<HTMLElement>('#stationPass');
const journeyStatus = required<HTMLElement>('#journeyStatus');
const departLabel = required<HTMLElement>('#departLabel');
const controlHint = required<HTMLElement>('#controlHint');
const arrivalStationName = required<HTMLElement>('#arrivalStationName');
const arrivalMessage = required<HTMLElement>('#arrivalMessage');
const soundIcon = required<HTMLElement>('#soundIcon');
const soundLabel = required<HTMLElement>('#soundLabel');

const queryMotion = query.get('motion');
const motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = queryMotion === 'reduce' || (queryMotion !== 'full' && motionMedia.matches);
const today = parsePreviewDate() ?? japanDateFromInstant();
const countdown = calculateCountdown(today);
const audio = new JourneyAudio();
const savedSound = safeStorageGet(SOUND_KEY) !== '0';
audio.setEnabled(savedSound);
soundToggle.setAttribute('aria-pressed', String(savedSound));
soundIcon.textContent = savedSound ? '♪' : '×';
soundLabel.textContent = savedSound ? 'おと あり' : 'おと なし';

const qualityChoice = chooseQuality();
app.dataset.quality = qualityChoice.quality;
app.dataset.carCount = String(qualityChoice.carCount);
app.dataset.motion = reducedMotion ? 'reduced' : 'full';
const formation = createE235Formation(qualityChoice);
let world: RailwayWorld | null = null;
if (query.get('webgl') === 'off') {
  formation.dispose();
  fallback.hidden = false;
  canvas.hidden = true;
  app.dataset.renderMode = 'fallback';
} else {
  try {
    world = new RailwayWorld(canvas, formation, { quality: qualityChoice.quality, reducedMotion });
    world.start();
    app.dataset.renderMode = 'webgl';
  } catch (error) {
    formation.dispose();
    fallback.hidden = false;
    canvas.hidden = true;
    app.dataset.renderMode = 'fallback';
    if (window.console) console.warn('WebGL fallback mode', error);
  }
}

let experienceState: ExperienceState = 'ready';
app.dataset.experienceState = experienceState;
let activeTimeline: gsap.core.Timeline | null = null;
let arrivalTimer: number | null = null;
let currentPlan: RidePlan = createRidePlan(countdown, parseRideMemory(safeStorageGet(RIDE_KEY)));

function showStation(days: number, departure: boolean): void {
  stationKicker.textContent = departure ? 'きのうの えきから' : 'きょうの えきに とうちゃく';
  if (days === 0) {
    stationPrefix.textContent = '';
    stationDays.textContent = '🎂';
    stationUnit.textContent = 'たんじょうびえき';
  } else {
    stationPrefix.textContent = 'あと';
    stationDays.textContent = String(days);
    stationUnit.textContent = 'にちえき';
  }
}

function preparePlan(plan: RidePlan): void {
  currentPlan = plan;
  showStation(plan.fromDays, true);
  destinationName.textContent = stationLabel(plan.toDays);
  proximity.textContent = proximityMessage(plan.toDays);
  departLabel.textContent = plan.toDays === 0 ? 'たんじょうびえきへ！' : 'ゆっくり しゅっぱつ';
  controlHint.textContent = plan.isReplay
    ? 'なんどでも おなじ たびを みられるよ'
    : plan.isCatchUp ? 'とちゅうの えきを とおって きょうに おいつくよ' : 'おすと、のこりにっすうが 1つ へるよ';
  journeyFill.style.width = '0%';
  journeyTrainIcon.style.left = '0%';
  stationPass.textContent = '';
  world?.setStations(plan.fromDays, plan.toDays);
  world?.setProgress(0);
  world?.setMotion(false, 0);
}

function setStatus(text: string): void {
  journeyStatus.textContent = text;
}

function completeJourney(): void {
  experienceState = 'arriving';
  app.dataset.experienceState = experienceState;
  world?.setProgress(1);
  world?.setMotion(false, 0);
  world?.celebrate();
  audio.stop();
  audio.playArrival();
  safeStorageSet(RIDE_KEY, serializeRideMemory(memoryAfterArrival(countdown)));
  showStation(currentPlan.toDays, false);
  destinationName.textContent = stationLabel(currentPlan.toDays);
  stationPass.textContent = currentPlan.toDays === 0 ? 'たんじょうびえき！' : `${stationLabel(currentPlan.toDays)} とうちゃく！`;
  journeyFill.style.width = '100%';
  journeyTrainIcon.style.left = '92%';
  setStatus(currentPlan.toDays === 0 ? 'たんじょうびえきに とうちゃくしました' : `${stationLabel(currentPlan.toDays)}に とうちゃくしました`);
  arrivalStationName.textContent = stationLabel(currentPlan.toDays);
  arrivalMessage.textContent = currentPlan.toDays === 0
    ? `${countdown.birthdayAge}さいの おたんじょうび おめでとう！`
    : 'たんじょうびえきが もっと ちかくなったよ';
  app.classList.remove('is-running', 'is-arrived');
  app.classList.add('is-arriving');
  arrivalPanel.hidden = true;
  experience.inert = true;
  topbar.inert = true;
  arrivalTimer = window.setTimeout(() => {
    experienceState = 'arrived';
    app.dataset.experienceState = experienceState;
    app.classList.remove('is-arriving');
    app.classList.add('is-arrived');
    arrivalPanel.hidden = false;
    departButton.disabled = false;
    window.requestAnimationFrame(() => replayButton.focus({ preventScroll: true }));
    arrivalTimer = null;
  }, reducedMotion ? 120 : 1050);
}

function updatePassStations(progressValue: number, lastIndex: { value: number }): void {
  if (currentPlan.passedStations.length === 0) return;
  const candidate = Math.min(
    currentPlan.passedStations.length - 1,
    Math.floor((progressValue - 0.2) / 0.18),
  );
  if (candidate >= 0 && candidate > lastIndex.value) {
    lastIndex.value = candidate;
    stationPass.textContent = `${stationLabel(currentPlan.passedStations[candidate])}を つうか！`;
  }
}

async function runJourney(): Promise<void> {
  if (experienceState === 'running' || experienceState === 'arriving') return;
  if (arrivalTimer !== null) {
    window.clearTimeout(arrivalTimer);
    arrivalTimer = null;
  }
  currentPlan = createRidePlan(countdown, parseRideMemory(safeStorageGet(RIDE_KEY)));
  preparePlan(currentPlan);
  experienceState = 'running';
  app.dataset.experienceState = experienceState;
  arrivalPanel.hidden = true;
  experience.inert = false;
  topbar.inert = false;
  app.classList.remove('is-arrived', 'is-arriving');
  app.classList.add('is-running');
  departButton.disabled = true;
  await audio.unlock().catch(() => undefined);
  const duration = reducedMotion ? 0.65 : 13.8;
  audio.playDeparture(duration);
  const motion = { progress: 0 };
  const lastPassIndex = { value: -1 };
  setStatus('しんごうが あおに なりました');

  activeTimeline?.kill();
  if (reducedMotion) {
    activeTimeline = gsap.timeline({ onComplete: completeJourney })
      .call(() => {
        motion.progress = 1;
        world?.setProgress(1);
        world?.setMotion(false, 0);
        journeyFill.style.width = '100%';
        journeyTrainIcon.style.left = '92%';
        setStatus(`${stationLabel(currentPlan.toDays)}に もうすぐ とうちゃく`);
      })
      .to({}, { duration });
    return;
  }
  activeTimeline = gsap.timeline({
    onComplete: completeJourney,
  });
  activeTimeline
    .to(motion, {
      progress: 0.12,
      duration: duration * 0.2,
      ease: 'power2.in',
      onStart: () => setStatus('E235けい しゅっぱつ！'),
      onUpdate: () => {
        const speed = Math.sin(Math.PI * motion.progress) * 24;
        world?.setProgress(motion.progress);
        world?.setMotion(true, speed);
        journeyFill.style.width = `${motion.progress * 100}%`;
        journeyTrainIcon.style.left = `${motion.progress * 92}%`;
      },
    })
    .to(motion, {
      progress: 0.7,
      duration: duration * 0.48,
      ease: 'sine.inOut',
      onStart: () => setStatus('トンネルを ぬけて、たんじょうびえきへ'),
      onUpdate: () => {
        const speed = Math.sin(Math.PI * motion.progress) * 27;
        world?.setProgress(motion.progress);
        world?.setMotion(true, speed);
        journeyFill.style.width = `${motion.progress * 100}%`;
        journeyTrainIcon.style.left = `${motion.progress * 92}%`;
        updatePassStations(motion.progress, lastPassIndex);
      },
    })
    .to(motion, {
      progress: 1,
      duration: duration * 0.32,
      ease: 'power2.out',
      onStart: () => setStatus(`${stationLabel(currentPlan.toDays)}が みえてきたよ`),
      onUpdate: () => {
        const speed = Math.max(0.8, (1 - motion.progress) * 28);
        world?.setProgress(motion.progress);
        world?.setMotion(true, speed);
        journeyFill.style.width = `${motion.progress * 100}%`;
        journeyTrainIcon.style.left = `${motion.progress * 92}%`;
        updatePassStations(motion.progress, lastPassIndex);
      },
    });
}

function restAtStation(): void {
  if (arrivalTimer !== null) {
    window.clearTimeout(arrivalTimer);
    arrivalTimer = null;
  }
  arrivalPanel.hidden = true;
  app.classList.remove('is-arrived', 'is-arriving');
  experienceState = 'ready';
  app.dataset.experienceState = experienceState;
  experience.inert = false;
  topbar.inert = false;
  departLabel.textContent = 'もういちど はしる';
  controlHint.textContent = 'なんどでも おなじ たびを みられるよ';
  departButton.focus({ preventScroll: true });
}

todayMeta.textContent = `きょう ${countdown.today.month}がつ${countdown.today.day}にち ・ ${countdown.birthdayAge}さいへ`;
preparePlan(currentPlan);
const scenePreview = Number(query.get('scene'));
if (query.has('scene') && Number.isFinite(scenePreview) && scenePreview >= 0 && scenePreview <= 1) {
  world?.setProgress(scenePreview);
  app.dataset.scenePreview = String(scenePreview);
}
setStatus('E235けいが しゅっぱつを まっているよ');

departButton.addEventListener('click', () => { void runJourney(); });
replayButton.addEventListener('click', () => {
  if (arrivalTimer !== null) {
    window.clearTimeout(arrivalTimer);
    arrivalTimer = null;
  }
  arrivalPanel.hidden = true;
  experience.inert = false;
  topbar.inert = false;
  experienceState = 'ready';
  app.dataset.experienceState = experienceState;
  void runJourney();
});
restButton.addEventListener('click', restAtStation);
arrivalPanel.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    restAtStation();
    return;
  }
  if (event.key !== 'Tab') return;
  const target = event.target;
  if (event.shiftKey && target === replayButton) {
    event.preventDefault();
    restButton.focus();
  } else if (!event.shiftKey && target === restButton) {
    event.preventDefault();
    replayButton.focus();
  }
});
soundToggle.addEventListener('click', () => {
  const enabled = !audio.isEnabled();
  audio.setEnabled(enabled);
  safeStorageSet(SOUND_KEY, enabled ? '1' : '0');
  soundToggle.setAttribute('aria-pressed', String(enabled));
  soundIcon.textContent = enabled ? '♪' : '×';
  soundLabel.textContent = enabled ? 'おと あり' : 'おと なし';
});

window.addEventListener('resize', () => world?.resize(), { passive: true });
document.addEventListener('visibilitychange', () => {
  if (!activeTimeline) return;
  if (document.hidden) activeTimeline.pause();
  else if (experienceState === 'running') activeTimeline.resume();
});
window.addEventListener('beforeunload', () => {
  activeTimeline?.kill();
  if (arrivalTimer !== null) window.clearTimeout(arrivalTimer);
  audio.stop();
  world?.dispose();
}, { once: true });

window.requestAnimationFrame(() => {
  window.requestAnimationFrame(() => app.classList.remove('is-loading'));
});

if (query.get('date')) {
  document.documentElement.dataset.previewDate = dateKey(today);
}
