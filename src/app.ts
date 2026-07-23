import { gsap } from 'gsap';
import './style.css';
import { JourneyAudio } from './audio';
import { sampleJourneyMotion } from './motion';
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
const journeyMapTitle = required<HTMLElement>('#journeyMapTitle');
const journeyRouteMap = required<HTMLElement>('#journeyRouteMap');
const routeFromRole = required<HTMLElement>('#routeFromRole');
const routeFromPrefix = required<HTMLElement>('#routeFromPrefix');
const routeFromDays = required<HTMLElement>('#routeFromDays');
const routeFromUnit = required<HTMLElement>('#routeFromUnit');
const routeToRole = required<HTMLElement>('#routeToRole');
const routeToPrefix = required<HTMLElement>('#routeToPrefix');
const routeToDays = required<HTMLElement>('#routeToDays');
const routeToUnit = required<HTMLElement>('#routeToUnit');
const journeyFill = required<HTMLElement>('#journeyFill');
const journeyTrainIcon = required<HTMLElement>('#journeyTrainIcon');
const journeyTrack = required<HTMLElement>('.journey-track');
const stationPass = required<HTMLElement>('#stationPass');
const journeyStatus = required<HTMLElement>('#journeyStatus');
const departLabel = required<HTMLElement>('#departLabel');
const controlHint = required<HTMLElement>('#controlHint');
const arrivalStationName = required<HTMLElement>('#arrivalStationName');
const arrivalFromStation = required<HTMLElement>('#arrivalFromStation');
const arrivalProgressLabel = required<HTMLElement>('#arrivalProgressLabel');
const arrivalMessage = required<HTMLElement>('#arrivalMessage');
const soundIcon = required<HTMLElement>('#soundIcon');
const soundLabel = required<HTMLElement>('#soundLabel');

const queryMotion = query.get('motion');
const motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = queryMotion === 'reduce' || (queryMotion !== 'full' && motionMedia.matches);
const previewDate = parsePreviewDate();
let today = previewDate ?? japanDateFromInstant();
let countdown = calculateCountdown(today);
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
let displayedProgress = 0;
let journeyTrackTravel = 0;

function updateJourneyHud(progress: number): void {
  displayedProgress = Math.min(1, Math.max(0, progress));
  journeyRouteMap.style.setProperty('--journey-progress', String(displayedProgress));
  journeyRouteMap.style.setProperty('--route-from-x', `${displayedProgress * -28}px`);
  journeyRouteMap.style.setProperty('--route-from-scale', String(1 - displayedProgress * 0.28));
  journeyRouteMap.style.setProperty('--route-from-opacity', String(1 - displayedProgress * 0.72));
  journeyRouteMap.style.setProperty('--route-to-x', `${(1 - displayedProgress) * 10}px`);
  journeyRouteMap.style.setProperty('--route-to-scale', String(0.92 + displayedProgress * 0.08));
  journeyFill.style.setProperty('--journey-progress', String(displayedProgress));
  journeyTrainIcon.style.setProperty('--journey-train-x', `${displayedProgress * journeyTrackTravel}px`);
}

function measureJourneyTrack(): void {
  // Read layout only at initialization/resize, never inside an animation tick.
  journeyTrackTravel = journeyTrack.clientWidth * 0.92;
  updateJourneyHud(displayedProgress);
}

function showStation(days: number, departure: boolean): void {
  stationKicker.textContent = departure ? 'いまの えき' : 'いまの えきに とうちゃく';
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

function setRouteBadge(
  days: number,
  prefix: HTMLElement,
  number: HTMLElement,
  unit: HTMLElement,
): void {
  const birthday = days === 0;
  prefix.textContent = birthday ? '' : 'あと';
  number.textContent = birthday ? '🎂' : String(days);
  unit.textContent = birthday ? 'たんじょうび' : 'にち';
  number.classList.toggle('is-birthday', birthday);
}

function updateRouteStations(plan: RidePlan, arrived: boolean): void {
  setRouteBadge(plan.fromDays, routeFromPrefix, routeFromDays, routeFromUnit);
  setRouteBadge(plan.toDays, routeToPrefix, routeToDays, routeToUnit);
  routeFromRole.textContent = arrived ? 'まえの えき' : 'いまの えき';
  routeToRole.textContent = arrived ? 'いまの えき' : plan.isCatchUp ? 'きょうの えき' : 'つぎの えき';
  journeyMapTitle.textContent = arrived
    ? plan.isCatchUp ? 'きょうの えきに ついたよ！' : 'ひとえき すすんだよ！'
    : plan.isCatchUp ? 'きょうの えきまで すすむよ' : 'きょうは ひとえき すすむよ';
  arrivalProgressLabel.textContent = plan.isCatchUp
    ? 'きょうの えきまで すすんだよ'
    : 'ひとえき すすんだよ';
  journeyRouteMap.dataset.arrived = String(arrived);
  journeyRouteMap.setAttribute(
    'aria-label',
    arrived
      ? `${stationLabel(plan.toDays)}に とうちゃく。ここが いまの えきです`
      : `${stationLabel(plan.fromDays)}が いまの えき。${stationLabel(plan.toDays)}へ すすみます`,
  );
  arrivalFromStation.textContent = stationLabel(plan.fromDays);
}

function preparePlan(plan: RidePlan): void {
  currentPlan = plan;
  showStation(plan.fromDays, true);
  updateRouteStations(plan, false);
  destinationName.textContent = stationLabel(plan.toDays);
  proximity.textContent = proximityMessage(plan.toDays);
  departLabel.textContent = plan.toDays === 0 ? 'たんじょうびえきへ！' : 'ゆっくり しゅっぱつ';
  controlHint.textContent = plan.isReplay
    ? 'なんどでも おなじ たびを みられるよ'
    : plan.isCatchUp ? 'とちゅうの えきを とおって きょうに おいつくよ' : 'おすと、のこりにっすうが 1つ へるよ';
  updateJourneyHud(0);
  stationPass.textContent = '';
  world?.setStations(plan.fromDays, plan.toDays);
  world?.setProgress(0);
  world?.setMotion(false, 0);
}

function setStatus(text: string): void {
  journeyStatus.textContent = text;
}

function updateTodayMeta(): void {
  todayMeta.textContent = `きょう ${countdown.today.month}がつ${countdown.today.day}にち ・ ${countdown.birthdayAge}さいへ`;
}

function refreshJapanDay(): boolean {
  if (previewDate) return false;
  const freshToday = japanDateFromInstant();
  if (dateKey(freshToday) === dateKey(today)) return false;
  today = freshToday;
  countdown = calculateCountdown(today);
  updateTodayMeta();
  preparePlan(createRidePlan(countdown, parseRideMemory(safeStorageGet(RIDE_KEY))));
  setStatus('あたらしい きょうの えきへ しゅっぱつできるよ');
  return true;
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
  updateRouteStations(currentPlan, true);
  destinationName.textContent = stationLabel(currentPlan.toDays);
  stationPass.textContent = currentPlan.toDays === 0 ? 'たんじょうびえき！' : `${stationLabel(currentPlan.toDays)} とうちゃく！`;
  updateJourneyHud(1);
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
  refreshJapanDay();
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
  const motion = { time: 0 };
  const lastPassIndex = { value: -1 };
  let statusStage = 0;
  const journeyDistance = world?.getJourneyDistance() ?? 0;
  setStatus(`${stationLabel(currentPlan.fromDays)}から ${stationLabel(currentPlan.toDays)}へ`);

  activeTimeline?.kill();
  if (reducedMotion) {
    activeTimeline = gsap.timeline({ onComplete: completeJourney })
      .call(() => {
        motion.time = 1;
        world?.setProgress(1);
        world?.setMotion(false, 0);
        updateJourneyHud(1);
        setStatus(`${stationLabel(currentPlan.toDays)}に もうすぐ とうちゃく`);
      })
      .to({}, { duration });
    return;
  }
  activeTimeline = gsap.timeline({ onComplete: completeJourney })
    .to(motion, {
      time: 1,
      duration,
      ease: 'none',
      onStart: () => setStatus(`${stationLabel(currentPlan.fromDays)}を しゅっぱつ！`),
      onUpdate: () => {
        const sample = sampleJourneyMotion(motion.time);
        const speed = journeyDistance * sample.normalizedVelocity / duration;
        world?.setProgress(sample.progress);
        world?.setMotion(true, speed);
        updateJourneyHud(sample.progress);
        updatePassStations(sample.progress, lastPassIndex);
        if (statusStage < 1 && sample.progress >= 0.12) {
          statusStage = 1;
          setStatus(`${stationLabel(currentPlan.toDays)}へ ゆっくり すすむよ`);
        }
        if (statusStage < 2 && sample.progress >= 0.7) {
          statusStage = 2;
          setStatus(`${stationLabel(currentPlan.toDays)}が みえてきたよ`);
        }
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

measureJourneyTrack();
updateTodayMeta();
preparePlan(currentPlan);
const scenePreview = Number(query.get('scene'));
if (query.has('scene') && Number.isFinite(scenePreview) && scenePreview >= 0 && scenePreview <= 1) {
  world?.setProgress(scenePreview);
  app.dataset.scenePreview = String(scenePreview);
}
setStatus(`${stationLabel(currentPlan.fromDays)}で しゅっぱつを まっているよ`);

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

window.addEventListener('resize', () => {
  measureJourneyTrack();
  world?.resize();
}, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    activeTimeline?.pause();
    world?.setSuspended(true);
    return;
  }
  world?.setSuspended(false);
  if (experienceState === 'running') activeTimeline?.resume();
  else if (experienceState === 'ready') refreshJapanDay();
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
