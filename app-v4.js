(function () {
  'use strict';

  var BIRTH_MONTH = 7;
  var BIRTH_DAY = 2;
  var BIRTH_YEAR = 2023;
  var DAY_MS = 86400000;
  var TIME_ZONE = 'Asia/Tokyo';
  var RIDE_STORAGE_KEY = 'birthday-train:last-ride-date-v3';
  var SOUND_STORAGE_KEY = 'birthday-train:sound-v3';

  var TRAIN_TYPES = [
    {
      id: 'loop',
      name: 'みどりの わっかでんしゃ',
      image: 'assets/train-loop-v2.webp',
      thumbnail: 'assets/train-loop-thumb-v2.webp',
      message: 'みどりの でんしゃが 1にち はこんだよ！',
      runningText: 'まちを ぐるっと しんこうちゅう',
      duration: 2700,
      whistle: [523.25, 659.25]
    },
    {
      id: 'express',
      name: 'あかい とっきゅう',
      image: 'assets/train-express-v2.webp',
      thumbnail: 'assets/train-express-thumb-v2.webp',
      message: 'あかい とっきゅうが びゅーんと はこんだよ！',
      runningText: 'びゅーん！ とっきゅう しんこうちゅう',
      duration: 2350,
      whistle: [587.33, 783.99]
    },
    {
      id: 'inspect',
      name: 'きいろの けんさでんしゃ',
      image: 'assets/train-inspect-v2.webp',
      thumbnail: 'assets/train-inspect-thumb-v2.webp',
      message: 'せんろを ぴかぴかにして はこんだよ！',
      runningText: 'せんろを てんけん しんこうちゅう',
      duration: 3100,
      whistle: [493.88, 739.99]
    }
  ];

  var app;
  var journeyShow;
  var journeyVehicle;
  var journeyTrain;
  var journeyBackground;
  var arrivalBackdrop;
  var trainShadow;
  var currentState;
  var selectedTrainIndex = 0;
  var journeyState = 'idle';
  var journeyToken = 0;
  var activeAnimations = [];
  var midnightTimer = 0;
  var previewRevealedDate = null;
  var audioContext = null;
  var activeTrainSound = null;
  var soundEnabled = true;
  var motionPreference = getQueryValue('motion');
  var motionMedia = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reducedMotion = motionPreference === 'reduce' || (motionPreference !== 'full' && motionMedia && motionMedia.matches);

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function pad2(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function safeFocus(element) {
    if (!element || typeof element.focus !== 'function') return;
    try {
      element.focus({ preventScroll: true });
    } catch (error) {
      try { element.focus(); } catch (ignored) { /* Focus is only an enhancement. */ }
    }
  }

  function safeGetStorage(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function safeSetStorage(key, value) {
    try { window.localStorage.setItem(key, value); } catch (error) { /* The app still works without storage. */ }
  }

  function getQueryValue(name) {
    if (typeof window.URLSearchParams === 'function') {
      return new URLSearchParams(window.location.search).get(name);
    }
    var match = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
  }

  function validPreviewDate(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var parts = value.split('-');
    var year = Number(parts[0]);
    var month = Number(parts[1]) - 1;
    var day = Number(parts[2]);
    var candidate = new Date(Date.UTC(year, month, day));
    if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month || candidate.getUTCDate() !== day) return null;
    return { year: year, month: month, day: day };
  }

  function getJapanDate() {
    var preview = validPreviewDate(getQueryValue('date'));
    if (preview) return preview;
    try {
      var parts = new Intl.DateTimeFormat('ja-JP', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
      }).formatToParts(new Date());
      var values = {};
      parts.forEach(function (part) { values[part.type] = Number(part.value); });
      return { year: values.year, month: values.month - 1, day: values.day };
    } catch (error) {
      var japanNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
      return { year: japanNow.getUTCFullYear(), month: japanNow.getUTCMonth(), day: japanNow.getUTCDate() };
    }
  }

  function dayNumber(date) {
    return Date.UTC(date.year, date.month, date.day) / DAY_MS;
  }

  function dateKey(date) {
    return date.year + '-' + pad2(date.month + 1) + '-' + pad2(date.day);
  }

  function isPreviewMode() {
    return Boolean(validPreviewDate(getQueryValue('date')));
  }

  function hasRiddenToday(today) {
    if (isPreviewMode()) return getQueryValue('revealed') === '1' || previewRevealedDate === dateKey(today);
    return safeGetStorage(RIDE_STORAGE_KEY) === dateKey(today);
  }

  function rememberTodayRide(today) {
    if (isPreviewMode()) previewRevealedDate = dateKey(today);
    else safeSetStorage(RIDE_STORAGE_KEY, dateKey(today));
  }

  function getCountdownState() {
    var today = getJapanDate();
    var thisBirthday = { year: today.year, month: BIRTH_MONTH, day: BIRTH_DAY };
    var difference = dayNumber(thisBirthday) - dayNumber(today);
    var targetYear = difference < 0 ? today.year + 1 : today.year;
    var birthday = { year: targetYear, month: BIRTH_MONTH, day: BIRTH_DAY };
    var previousBirthday = { year: targetYear - 1, month: BIRTH_MONTH, day: BIRTH_DAY };
    var actualDays = dayNumber(birthday) - dayNumber(today);
    var fullJourneyDays = dayNumber(birthday) - dayNumber(previousBirthday);
    var traveledDays = dayNumber(today) - dayNumber(previousBirthday);
    var progress = actualDays === 0 ? 100 : Math.max(0, Math.min(100, traveledDays / fullJourneyDays * 100));
    return {
      today: today,
      birthday: birthday,
      targetYear: targetYear,
      actualDays: actualDays,
      birthdayAge: targetYear - BIRTH_YEAR,
      progress: progress,
      revealed: hasRiddenToday(today)
    };
  }

  function getWeekday(date) {
    var weekdays = ['にち', 'げつ', 'か', 'すい', 'もく', 'きん', 'ど'];
    return weekdays[new Date(Date.UTC(date.year, date.month, date.day)).getUTCDay()];
  }

  function setText(selector, value) {
    var element = $(selector);
    if (element) element.textContent = value;
  }

  function getRouteProgress(days) {
    if (days <= 0) return 100;
    var daysInTheater = Math.min(30, days);
    return 6 + ((30 - daysInTheater) / 30 * 88);
  }

  function getDistanceMood(days) {
    if (days <= 0) return 'とうちゃく！';
    if (days <= 3) return 'もう みえる！';
    if (days <= 7) return 'すぐ そこ！';
    if (days <= 14) return 'もうすぐ！';
    if (days <= 30) return 'ちかづいてる！';
    return 'たびの とちゅう';
  }

  function setHomeRoutePosition(progress) {
    var guide = $('#routeGuide');
    var train = $('#miniTrain');
    if (!guide || !train || typeof guide.getTotalLength !== 'function') return;
    var length = guide.getTotalLength();
    var point = guide.getPointAtLength(length * Math.max(0, Math.min(100, progress)) / 100);
    train.style.setProperty('--route-x', (point.x / 7) + '%');
    train.style.setProperty('--route-y', (point.y / 2.6) + '%');
  }

  function renderCountdown(animate) {
    currentState = getCountdownState();
    var days = currentState.actualDays;
    var birthday = days === 0;
    var progress = Math.round(getRouteProgress(days) * 10) / 10;
    var countdownDisplay = $('#countdownDisplay');
    var track = $('#track');
    var routeMap = $('#routeMap');

    setText('#todayLabel', 'きょう ' + (currentState.today.month + 1) + '/' + currentState.today.day + '（' + getWeekday(currentState.today) + '）');
    setText('#daysNumber', birthday ? 'きょう！' : String(days));
    setText('#eyebrow', birthday ? '8がつ2にち' : (currentState.targetYear === currentState.today.year ? '8がつ2にちまで' : 'つぎの 8がつ2にちまで'));
    setText('#routeRemaining', birthday ? 'とうちゃく！' : 'あと ' + days + ' えき');
    setText('#distanceMood', getDistanceMood(days));
    setText('#routeDaysBig', birthday ? '0' : String(days));
    setText('#arrivalSignPrefix', birthday ? '' : 'あと');
    setText('#arrivalSignDays', birthday ? 'おたんじょうび！' : String(days));
    setText('#arrivalSignUnit', birthday ? '' : 'にち');
    setText('#routeJourneyMessage', birthday
      ? 'たんじょうびえきに とうちゃく！'
      : days > 30 ? '30にちまえから えきが みえてくるよ' : 'きょうも 1えき、もっと ちかづくよ');
    setText('#buttonLabel', birthday ? 'おいわいれっしゃ しゅっぱつ！' : 'でんしゃを 1えき すすめる');
    setText('#buttonHint', birthday ? 'おたんじょうび おめでとう！' : 'なんどでも みられるよ');
    setText('#rideNote', currentState.revealed ? 'きょうの 1えき、とうちゃくずみ！ もういちど はしれるよ' : 'おすと、きのうから きょうへ すすむよ');

    if ($('#countdownTitle')) {
      $('#countdownTitle').innerHTML = birthday
        ? currentState.birthdayAge + 'さいの おたんじょうび<br><span>おめでとう！</span>'
        : currentState.birthdayAge + 'さいの おたんじょうびへ<br><span>きょうも 1えき すすもう！</span>';
    }

    if (countdownDisplay) {
      countdownDisplay.classList.toggle('is-birthday', birthday);
      countdownDisplay.classList.toggle('is-long', days >= 100);
      $('.count-prefix').hidden = birthday;
      $('.count-unit').hidden = birthday;
    }

    if ($('#trackFill')) $('#trackFill').style.strokeDasharray = progress + ' 100';
    setHomeRoutePosition(progress);
    if (routeMap) {
      routeMap.classList.toggle('is-near', days <= 14 && days > 0);
      routeMap.classList.toggle('is-week-away', days <= 7 && days > 3);
      routeMap.classList.toggle('is-very-near', days <= 3 && days > 0);
      routeMap.classList.toggle('is-arrived', birthday);
    }
    if (track) {
      track.setAttribute('aria-valuenow', String(Math.round(progress)));
      track.setAttribute('aria-valuetext', birthday ? 'たんじょうび駅に到着' : 'たんじょうび駅まであと' + days + '日、30日前からの道のりを表示');
      if (animate) {
        track.classList.remove('is-advancing');
        window.requestAnimationFrame(function () {
          track.classList.add('is-advancing');
          window.setTimeout(function () { track.classList.remove('is-advancing'); }, 950);
        });
      }
    }
  }

  function scheduleMidnightUpdate() {
    window.clearTimeout(midnightTimer);
    if (isPreviewMode()) return;
    var now = new Date();
    var japanNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    var nextMidnight = Date.UTC(japanNow.getUTCFullYear(), japanNow.getUTCMonth(), japanNow.getUTCDate() + 1) - 9 * 60 * 60 * 1000;
    midnightTimer = window.setTimeout(function () {
      renderCountdown(false);
      scheduleMidnightUpdate();
    }, Math.max(1000, nextMidnight - now.getTime() + 300));
  }

  function updateTrainSelection(index) {
    selectedTrainIndex = (index + TRAIN_TYPES.length) % TRAIN_TYPES.length;
    var inputs = $all('input[name="train"]');
    inputs.forEach(function (input, inputIndex) {
      input.checked = inputIndex === selectedTrainIndex;
      var label = input.closest ? input.closest('.train-option') : input.parentNode;
      if (label) label.classList.toggle('is-selected', input.checked);
    });
    var homeTrain = $('#homeRouteTrain');
    if (homeTrain) homeTrain.src = TRAIN_TYPES[selectedTrainIndex].thumbnail;
  }

  function getAudioContext() {
    if (!soundEnabled) return null;
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === 'suspended') {
      try {
        var resumeResult = audioContext.resume();
        if (resumeResult && typeof resumeResult.catch === 'function') resumeResult.catch(function () { return null; });
      } catch (error) { /* Sound must never block the journey. */ }
    }
    return audioContext;
  }

  function stopTrainSound() {
    if (!activeTrainSound || !audioContext) return;
    var now = audioContext.currentTime;
    try {
      activeTrainSound.master.gain.cancelScheduledValues(now);
      activeTrainSound.master.gain.setValueAtTime(0.04, now);
      activeTrainSound.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      activeTrainSound.sources.forEach(function (source) {
        try { source.stop(now + 0.06); } catch (error) { /* Already stopped. */ }
      });
    } catch (error) { /* Sound cleanup is best effort. */ }
    activeTrainSound = null;
  }

  function playTrainSound(type) {
    var context;
    try { context = getAudioContext(); } catch (error) { return; }
    if (!context) return;
    stopTrainSound();
    var now = context.currentTime;
    var sources = [];
    var master = context.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.09, now + 0.04);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    master.connect(context.destination);
    type.whistle.forEach(function (frequency, index) {
      var oscillator = context.createOscillator();
      var gain = context.createGain();
      oscillator.type = type.id === 'express' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.04, now + 0.72);
      gain.gain.value = index ? 0.25 : 0.62;
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now);
      oscillator.stop(now + 1.5);
      sources.push(oscillator);
    });
    activeTrainSound = { master: master, sources: sources };
  }

  function playArrivalChime() {
    var context;
    try { context = getAudioContext(); } catch (error) { return; }
    if (!context) return;
    stopTrainSound();
    var now = context.currentTime;
    var sources = [];
    var master = context.createGain();
    master.gain.setValueAtTime(0.88, now);
    master.connect(context.destination);
    [659.25, 783.99, 987.77].forEach(function (frequency, index) {
      var oscillator = context.createOscillator();
      var gain = context.createGain();
      var start = now + index * 0.12;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.075, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(start + 0.42);
      sources.push(oscillator);
    });
    activeTrainSound = { master: master, sources: sources };
  }

  function setSoundEnabled(value) {
    soundEnabled = Boolean(value);
    safeSetStorage(SOUND_STORAGE_KEY, soundEnabled ? '1' : '0');
    var button = $('#soundToggle');
    if (button) button.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false');
    setText('#soundIcon', soundEnabled ? '🔔' : '🔕');
    setText('#soundLabel', soundEnabled ? 'おと あり' : 'おと なし');
    if (!soundEnabled) stopTrainSound();
  }

  function wait(milliseconds) {
    return new Promise(function (resolve) { window.setTimeout(resolve, milliseconds); });
  }

  function afterTwoFrames() {
    return new Promise(function (resolve) {
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(resolve);
      });
    });
  }

  function applyFrame(element, frame) {
    Object.keys(frame).forEach(function (property) {
      if (property !== 'offset' && property !== 'easing' && property !== 'composite') element.style[property] = frame[property];
    });
  }

  function animateElement(element, frames, options) {
    if (!element) return wait(options.duration || 0);
    var duration = options.duration || 0;
    if (typeof element.animate !== 'function') {
      return wait(duration).then(function () { applyFrame(element, frames[frames.length - 1]); });
    }
    var animation;
    try {
      animation = element.animate(frames, options);
      activeAnimations.push(animation);
      var completion;
      if (animation.finished && typeof animation.finished.then === 'function') {
        completion = Promise.resolve(animation.finished).then(function () { return true; }).catch(function () { return false; });
      } else {
        completion = new Promise(function (resolve) {
          var settled = false;
          var finish = function (completed) {
            if (settled) return;
            settled = true;
            resolve(completed);
          };
          animation.onfinish = function () { finish(true); };
          animation.oncancel = function () { finish(false); };
          window.setTimeout(function () { finish(true); }, duration + 120);
        });
      }
      return completion.then(function (completed) {
        var index = activeAnimations.indexOf(animation);
        if (index >= 0) activeAnimations.splice(index, 1);
        if (completed) applyFrame(element, frames[frames.length - 1]);
        try { animation.cancel(); } catch (error) { /* No-op. */ }
      });
    } catch (error) {
      return wait(duration).then(function () { applyFrame(element, frames[frames.length - 1]); });
    }
  }

  function cancelAnimations() {
    activeAnimations.forEach(function (animation) {
      try { animation.cancel(); } catch (error) { /* No-op. */ }
    });
    activeAnimations = [];
  }

  function replayHomeRouteProgress(rideState, token) {
    var guide = $('#routeGuide');
    var miniTrain = $('#miniTrain');
    var routeMap = $('#routeMap');
    var trackFill = $('#trackFill');
    var endProgress = getRouteProgress(rideState.actualDays);
    var startProgress = getRouteProgress(rideState.actualDays + 1);
    if (startProgress === endProgress) startProgress = Math.max(0, endProgress - 3);
    var duration = reducedMotion ? 180 : 820;

    if (!guide || !miniTrain || typeof guide.getTotalLength !== 'function') {
      setHomeRoutePosition(endProgress);
      return wait(duration);
    }

    var length = guide.getTotalLength();
    var frames = [];
    var frameCount = reducedMotion ? 2 : 18;
    for (var index = 0; index <= frameCount; index += 1) {
      var amount = index / frameCount;
      var eased = 1 - Math.pow(1 - amount, 3);
      var progress = startProgress + (endProgress - startProgress) * eased;
      var point = guide.getPointAtLength(length * progress / 100);
      frames.push({ left: (point.x / 7) + '%', top: (point.y / 2.6) + '%', offset: amount });
    }

    if (routeMap) routeMap.classList.add('is-replaying');
    setHomeRoutePosition(startProgress);
    if (trackFill) trackFill.style.strokeDasharray = startProgress + ' 100';

    return afterTwoFrames().then(function () {
      if (token !== journeyToken) return null;
      var promises = [animateElement(miniTrain, frames, {
        duration: duration,
        easing: 'linear',
        fill: 'forwards'
      })];
      if (trackFill) {
        promises.push(animateElement(trackFill, [
          { strokeDasharray: startProgress + ' 100' },
          { strokeDasharray: endProgress + ' 100' }
        ], { duration: duration, easing: 'cubic-bezier(.18,.8,.22,1)', fill: 'forwards' }));
      }
      return Promise.all(promises);
    }).then(function () {
      miniTrain.style.removeProperty('left');
      miniTrain.style.removeProperty('top');
      setHomeRoutePosition(endProgress);
      if (trackFill) trackFill.style.strokeDasharray = endProgress + ' 100';
      if (routeMap) routeMap.classList.remove('is-replaying');
      return null;
    });
  }

  function prepareHighResolutionTrain(type, token) {
    var highResolution = new Image();
    var source = getQueryValue('asset') === 'fail' ? 'assets/__missing-train.webp' : type.image;
    highResolution.decoding = 'async';
    var swapWhenReady = function () {
      if (token !== journeyToken || !highResolution.naturalWidth) return;
      journeyTrain.src = type.image;
    };
    highResolution.addEventListener('load', swapWhenReady, { once: true });
    highResolution.src = source;
    if (highResolution.complete) swapWhenReady();
    if (typeof highResolution.decode === 'function') {
      highResolution.decode().then(swapWhenReady).catch(function () { return null; });
    }
  }

  function setJourneyStatus(text) {
    setText('#journeyStatus', text);
    setText('#visualStatus', text);
  }

  function clearArrivalBurst() {
    var burst = $('#arrivalBurst');
    if (!burst) return;
    while (burst.firstChild) burst.removeChild(burst.firstChild);
  }

  function makeArrivalBurst() {
    var burst = $('#arrivalBurst');
    if (!burst) return;
    clearArrivalBurst();
    var symbols = ['★', '●', '◆', '★', '●'];
    for (var index = 0; index < 26; index += 1) {
      var star = document.createElement('i');
      var angle = Math.PI * 2 * index / 26;
      var distance = 80 + Math.random() * Math.min(window.innerWidth, 290);
      star.className = 'arrival-star';
      star.textContent = symbols[index % symbols.length];
      star.style.setProperty('--star-x', Math.cos(angle) * distance + 'px');
      star.style.setProperty('--star-y', Math.sin(angle) * distance * 0.72 + 'px');
      star.style.setProperty('--star-r', (-180 + Math.random() * 360) + 'deg');
      star.style.setProperty('--star-size', (10 + Math.random() * 18) + 'px');
      star.style.setProperty('--star-delay', (Math.random() * 0.18) + 's');
      burst.appendChild(star);
    }
  }

  function makeConfetti(amount) {
    var container = $('#confetti');
    if (!container) return;
    var colors = ['#f7cf5a', '#e9694d', '#087da7', '#75b895', '#ffffff'];
    for (var index = 0; index < amount; index += 1) {
      var piece = document.createElement('i');
      piece.className = 'confetti-piece';
      piece.style.left = (Math.random() * 100) + 'vw';
      piece.style.background = colors[index % colors.length];
      piece.style.setProperty('--duration', (2 + Math.random() * 1.2) + 's');
      piece.style.setProperty('--delay', (Math.random() * 0.28) + 's');
      piece.style.setProperty('--drift', (-70 + Math.random() * 140) + 'px');
      piece.style.setProperty('--spin', (360 + Math.random() * 720) + 'deg');
      container.appendChild(piece);
      window.setTimeout((function (node) { return function () { if (node.parentNode) node.parentNode.removeChild(node); }; }(piece)), 3800);
    }
  }

  function resetJourneyScene(type, rideState) {
    cancelAnimations();
    clearArrivalBurst();
    journeyShow.className = 'journey-show scene--' + type.id + ' is-preparing';
    journeyShow.setAttribute('data-state', 'preparing');
    journeyTrain.src = type.thumbnail;
    journeyVehicle.style.opacity = '0.88';
    journeyVehicle.style.transform = reducedMotion ? 'translate3d(-50%, 0, 0) scale(.96)' : 'translate3d(-67%, 0, 0) scale(.94)';
    journeyBackground.style.transform = 'scale(1.06) translate3d(0, 0, 0)';
    arrivalBackdrop.style.opacity = '0';
    arrivalBackdrop.style.transform = 'scale(1.13) translate3d(3%, 1%, 0)';
    trainShadow.style.opacity = '0.48';
    trainShadow.style.transform = 'translateX(-62%) scale(.86)';
    var card = $('#arrivalCard');
    card.hidden = true;
    card.classList.remove('is-visible');
    card.classList.toggle('is-birthday', rideState.actualDays === 0);
    card.setAttribute('aria-hidden', 'true');
    $('#returnButton').disabled = true;
    $('#replayButton').disabled = true;
    setText('#showTitle', type.name);
    setText('#showKicker', 'しんごう まち');
    setText('#showCountLabel', rideState.actualDays === 0 ? 'きょうは' : 'きのうは あと');
    setText('#showDaysNumber', rideState.actualDays === 0 ? 'おたんじょうび' : String(rideState.actualDays + 1));
    setText('#showCountUnit', rideState.actualDays === 0 ? '' : 'にち');
    setText('#arrivalPrefix', rideState.actualDays === 0 ? 'きょうは' : 'たんじょうびまで あと');
    setText('#arrivalDays', rideState.actualDays === 0 ? 'おたんじょうび！' : String(rideState.actualDays));
    setText('#arrivalUnit', rideState.actualDays === 0 ? '' : 'にち');
    setText('#arrivalMessage', rideState.actualDays === 0 ? 'おたんじょうび おめでとう！' : type.message);
    setText('#approachBefore', rideState.actualDays === 0 ? 'きのう あと1' : 'きのう あと' + (rideState.actualDays + 1));
    setText('#approachToday', rideState.actualDays === 0 ? 'きょう おたんじょうび！' : 'きょう あと' + rideState.actualDays);
    var approachFill = $('#approachFill');
    var approachTrain = $('#approachTrain');
    if (approachFill) approachFill.style.width = '4%';
    if (approachTrain) approachTrain.style.left = '4%';
    var arrivalSign = $('#arrivalSign');
    if (arrivalSign) arrivalSign.classList.toggle('is-birthday', rideState.actualDays === 0);
    setText('#arrivalSignPrefix', rideState.actualDays === 0 ? '' : 'あと');
    setText('#arrivalSignDays', rideState.actualDays === 0 ? 'おたんじょうび！' : String(rideState.actualDays));
    setText('#arrivalSignUnit', rideState.actualDays === 0 ? '' : 'にち');
    setJourneyStatus('しゅっぱつ じゅんび');
  }

  function flipTicketToToday(token, rideState) {
    var ticket = $('#showTicket');
    var firstDuration = reducedMotion ? 120 : 220;
    var secondDuration = reducedMotion ? 160 : 300;
    return animateElement(ticket, [
      { transform: 'rotateX(0deg) scale(1)', opacity: '1' },
      { transform: 'rotateX(82deg) scale(.94)', opacity: '.25' }
    ], { duration: firstDuration, easing: 'ease-in', fill: 'forwards' }).then(function () {
      if (token !== journeyToken) return null;
      setText('#showCountLabel', rideState.actualDays === 0 ? 'きょうは' : 'きょうは あと');
      setText('#showDaysNumber', rideState.actualDays === 0 ? 'おたんじょうび！' : String(rideState.actualDays));
      setText('#showCountUnit', rideState.actualDays === 0 ? '' : 'にち');
      ticket.style.transform = 'rotateX(-82deg) scale(.94)';
      return animateElement(ticket, [
        { transform: 'rotateX(-82deg) scale(.94)', opacity: '.25' },
        { transform: 'rotateX(0deg) scale(1.05)', opacity: '1', offset: .72 },
        { transform: 'rotateX(0deg) scale(1)', opacity: '1' }
      ], { duration: secondDuration, easing: 'cubic-bezier(.18,.85,.22,1)', fill: 'forwards' });
    });
  }

  function runJourneySequence(type, token, rideState) {
    var entryDuration = reducedMotion ? 220 : 470;
    var runDuration = reducedMotion ? 720 : type.duration;
    var arrivalDuration = reducedMotion ? 240 : 620;

    return afterTwoFrames().then(function () {
      if (token !== journeyToken) return null;
      journeyState = 'running';
      journeyShow.classList.remove('is-preparing');
      journeyShow.classList.add('is-running');
      journeyShow.setAttribute('data-state', 'running');
      setText('#showKicker', 'しんごう あお！');
      setJourneyStatus('しゅっぱつ！');
      var entry = animateElement(journeyVehicle, [
        { transform: reducedMotion ? 'translate3d(-50%, 0, 0) scale(.96)' : 'translate3d(-67%, 0, 0) scale(.94)', opacity: '.88' },
        { transform: 'translate3d(-50%, 0, 0) scale(1)', opacity: '1' }
      ], { duration: entryDuration, easing: 'cubic-bezier(.18,.82,.26,1)', fill: 'forwards' });
      animateElement(trainShadow, [
        { transform: 'translateX(-62%) scale(.86)', opacity: '.35' },
        { transform: 'translateX(-50%) scale(1)', opacity: '.48' }
      ], { duration: entryDuration, easing: 'ease-out', fill: 'forwards' });
      return entry;
    }).then(function () {
      if (token !== journeyToken) return null;
      setJourneyStatus(type.runningText);
      var bob = type.id === 'express' ? -5 : type.id === 'inspect' ? -3 : -7;
      var runningFrames = reducedMotion ? [
        { transform: 'translate3d(-50%, 0, 0) scale(1)', opacity: '1' },
        { transform: 'translate3d(-50%, 0, 0) scale(.98)', opacity: '.84', offset: .5 },
        { transform: 'translate3d(-50%, 0, 0) scale(1)', opacity: '1' }
      ] : [
        { transform: 'translate3d(-50%, 0, 0) scale(1)' },
        { transform: 'translate3d(-49.4%, ' + bob + 'px, 0) scale(' + (type.id === 'express' ? '1.035' : '1.01') + ')', offset: .28 },
        { transform: 'translate3d(-50.3%, 2px, 0) scale(1)', offset: .58 },
        { transform: 'translate3d(-49.7%, ' + (bob / 2) + 'px, 0) scale(1.008)', offset: .82 },
        { transform: 'translate3d(-50%, 0, 0) scale(1)' }
      ];
      var running = animateElement(journeyVehicle, runningFrames, { duration: runDuration, easing: reducedMotion ? 'ease-in-out' : 'linear', fill: 'forwards' });
      animateElement($('#approachFill'), [
        { width: '4%' },
        { width: '92%' }
      ], { duration: runDuration, easing: 'cubic-bezier(.12,.72,.18,1)', fill: 'forwards' });
      animateElement($('#approachTrain'), [
        { left: '4%', transform: 'translate(-50%, -50%) scale(.9)' },
        { left: '92%', transform: 'translate(-50%, -50%) scale(1.08)', offset: .82 },
        { left: '92%', transform: 'translate(-50%, -50%) scale(1)' }
      ], { duration: runDuration, easing: 'cubic-bezier(.12,.72,.18,1)', fill: 'forwards' });
      animateElement(arrivalBackdrop, [
        { opacity: '0', transform: 'scale(1.13) translate3d(3%, 1%, 0)' },
        { opacity: reducedMotion ? '.35' : '.24', transform: 'scale(1.055) translate3d(1%, 0, 0)' }
      ], { duration: runDuration, easing: 'ease-in', fill: 'forwards' });
      if (!reducedMotion) {
        animateElement(journeyBackground, [
          { transform: 'scale(1.06) translate3d(0, 0, 0)' },
          { transform: type.id === 'express' ? 'scale(1.2) translate3d(-4.2%, 0, 0)' : 'scale(1.16) translate3d(-3%, 0, 0)' }
        ], { duration: runDuration, easing: 'ease-in-out', fill: 'forwards' });
      }
      return running;
    }).then(function () {
      if (token !== journeyToken) return null;
      journeyState = 'arriving';
      journeyShow.classList.remove('is-running');
      journeyShow.classList.add('has-arrived');
      journeyShow.setAttribute('data-state', 'arriving');
      setText('#showKicker', 'たんじょうびえき');
      setJourneyStatus('まもなく とうちゃく');
      var arrivalTransform = reducedMotion ? 'translate3d(-58%, 0, 0) scale(.88)' : 'translate3d(-66%, 5px, 0) scale(.82)';
      var arriving = animateElement(journeyVehicle, [
        { transform: 'translate3d(-50%, 0, 0) scale(1)', opacity: '1' },
        { transform: arrivalTransform, opacity: reducedMotion ? '.82' : '1' }
      ], { duration: arrivalDuration, easing: 'cubic-bezier(.18,.72,.2,1)', fill: 'forwards' });
      animateElement(arrivalBackdrop, [
        { opacity: reducedMotion ? '.35' : '.24', transform: 'scale(1.055) translate3d(1%, 0, 0)' },
        { opacity: '1', transform: 'scale(1) translate3d(0, 0, 0)' }
      ], { duration: arrivalDuration, easing: 'cubic-bezier(.18,.72,.2,1)', fill: 'forwards' });
      animateElement(trainShadow, [
        { transform: 'translateX(-50%) scale(1)', opacity: '.48' },
        { transform: reducedMotion ? 'translateX(-58%) scale(.82)' : 'translateX(-66%) scale(.74)', opacity: '.3' }
      ], { duration: arrivalDuration, easing: 'ease-out', fill: 'forwards' });
      return arriving;
    }).then(function () {
      if (token !== journeyToken) return null;
      return flipTicketToToday(token, rideState);
    }).then(function () {
      if (token !== journeyToken) return null;
      rememberTodayRide(rideState.today);
      renderCountdown(true);
      setJourneyStatus(rideState.actualDays === 0
        ? 'とうちゃくしました。きょうは おたんじょうびです'
        : 'とうちゃくしました。たんじょうびまで あと' + rideState.actualDays + 'にちです');
      makeArrivalBurst();
      makeConfetti(rideState.actualDays === 0 ? 52 : 30);
      try { playArrivalChime(); } catch (error) { /* The visual result is complete without sound. */ }
      if (navigator.vibrate) {
        try { navigator.vibrate([20, 35, 20]); } catch (error) { /* Vibration is optional. */ }
      }
      return wait(reducedMotion ? 220 : 520);
    }).then(function () {
      if (token !== journeyToken) return null;
      journeyState = 'complete';
      journeyShow.classList.add('is-complete');
      journeyShow.setAttribute('data-state', 'complete');
      var card = $('#arrivalCard');
      card.hidden = false;
      card.setAttribute('aria-hidden', 'false');
      window.requestAnimationFrame(function () { card.classList.add('is-visible'); });
      $('#returnButton').disabled = false;
      $('#replayButton').disabled = false;
      safeFocus($('#returnButton'));
      return null;
    }).catch(function (error) {
      if (token !== journeyToken) return;
      showJourneyFallback(type, rideState);
    });
  }

  function showJourneyFallback(type, rideState) {
    journeyState = 'complete';
    journeyShow.className = 'journey-show scene--' + type.id + ' has-arrived is-complete';
    journeyVehicle.style.opacity = '1';
    journeyVehicle.style.transform = 'translate3d(-66%, 5px, 0) scale(.82)';
    arrivalBackdrop.style.opacity = '1';
    arrivalBackdrop.style.transform = 'scale(1) translate3d(0, 0, 0)';
    setText('#showKicker', 'たんじょうびえき');
    setText('#showCountLabel', rideState.actualDays === 0 ? 'きょうは' : 'きょうは あと');
    setText('#showDaysNumber', rideState.actualDays === 0 ? 'おたんじょうび！' : String(rideState.actualDays));
    setText('#showCountUnit', rideState.actualDays === 0 ? '' : 'にち');
    setJourneyStatus(rideState.actualDays === 0
      ? 'とうちゃくしました。きょうは おたんじょうびです'
      : 'とうちゃくしました。たんじょうびまで あと' + rideState.actualDays + 'にちです');
    rememberTodayRide(rideState.today);
    renderCountdown(true);
    var card = $('#arrivalCard');
    card.hidden = false;
    card.setAttribute('aria-hidden', 'false');
    card.classList.add('is-visible');
    $('#returnButton').disabled = false;
    $('#replayButton').disabled = false;
  }

  function startJourney(fromReplay) {
    if (journeyState === 'preparing' || journeyState === 'running' || journeyState === 'arriving') return;
    var type = TRAIN_TYPES[selectedTrainIndex];
    var token = ++journeyToken;
    var overlayAlreadyOpen = !journeyShow.hidden;
    journeyState = 'preparing';
    currentState = getCountdownState();
    var rideState = {
      today: { year: currentState.today.year, month: currentState.today.month, day: currentState.today.day },
      actualDays: currentState.actualDays,
      birthdayAge: currentState.birthdayAge,
      targetYear: currentState.targetYear
    };

    var departButton = $('#departButton');
    if (departButton) {
      departButton.classList.add('is-pressed');
      window.setTimeout(function () { departButton.classList.remove('is-pressed'); }, 170);
    }

    var openJourneyShow = function () {
      if (token !== journeyToken) return;
      resetJourneyScene(type, rideState);
      journeyShow.hidden = false;
      journeyShow.setAttribute('aria-hidden', 'false');
      document.body.classList.add('show-is-open');
      app.setAttribute('aria-hidden', 'true');
      app.setAttribute('inert', '');
      safeFocus($('#showClose'));
      prepareHighResolutionTrain(type, token);
      try { playTrainSound(type); } catch (error) { /* Sound must never block the first frame. */ }
      runJourneySequence(type, token, rideState);
    };

    if (overlayAlreadyOpen || fromReplay) {
      openJourneyShow();
    } else {
      try { getAudioContext(); } catch (error) { /* Unlocking audio is optional. */ }
      replayHomeRouteProgress(rideState, token).then(openJourneyShow);
    }
  }

  function closeJourney() {
    journeyToken += 1;
    journeyState = 'idle';
    cancelAnimations();
    stopTrainSound();
    clearArrivalBurst();
    journeyShow.hidden = true;
    journeyShow.setAttribute('aria-hidden', 'true');
    journeyShow.className = 'journey-show';
    document.body.classList.remove('show-is-open');
    app.removeAttribute('aria-hidden');
    app.removeAttribute('inert');
    safeFocus($('#departButton'));
  }

  function trapDialogFocus(event) {
    if (journeyShow.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeJourney();
      return;
    }
    if (event.key !== 'Tab') return;
    var focusable = journeyState === 'complete'
      ? [$('#showClose'), $('#returnButton'), $('#replayButton')]
      : [$('#showClose')];
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (focusable.length === 1 || (event.shiftKey && document.activeElement === first)) {
      event.preventDefault();
      safeFocus(last);
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      safeFocus(first);
    }
  }

  function preloadJourneyAssets() {
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var saveData = connection && connection.saveData;
    var sources = [TRAIN_TYPES[selectedTrainIndex].image];
    sources.push(window.matchMedia && window.matchMedia('(max-width: 720px)').matches
      ? 'assets/journey-mobile-v2.webp'
      : 'assets/journey-desktop-v2.webp');
    sources.push(window.matchMedia && window.matchMedia('(max-width: 720px)').matches
      ? 'assets/arrival-mobile-v3.webp'
      : 'assets/arrival-desktop-v3.webp');
    if (!saveData) {
      TRAIN_TYPES.forEach(function (type, index) {
        if (index !== selectedTrainIndex) sources.push(type.image);
      });
    }
    sources.forEach(function (source) {
      var image = new Image();
      image.decoding = 'async';
      image.src = source;
    });
  }

  function bindEvents() {
    $('#departButton').addEventListener('click', function () { startJourney(false); });
    $('#replayButton').addEventListener('click', function () { startJourney(true); });
    $('#returnButton').addEventListener('click', closeJourney);
    $('#showClose').addEventListener('click', closeJourney);
    $('#soundToggle').addEventListener('click', function () { setSoundEnabled(!soundEnabled); });
    $all('input[name="train"]').forEach(function (input, index) {
      input.addEventListener('change', function () { if (input.checked) updateTrainSelection(index); });
    });
    document.addEventListener('keydown', trapDialogFocus);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && journeyState === 'idle') {
        renderCountdown(false);
        scheduleMidnightUpdate();
      }
    });
  }

  function initialize() {
    app = $('#app');
    journeyShow = $('#journeyShow');
    journeyVehicle = $('#journeyVehicle');
    journeyTrain = $('#journeyTrain');
    journeyBackground = $('#journeyBackground');
    arrivalBackdrop = $('#arrivalBackdrop');
    trainShadow = $('#trainShadow');
    if (!app || !journeyShow || !journeyVehicle || !journeyTrain || !arrivalBackdrop || !$('#departButton') || !$('#routeRemaining')) {
      throw new Error('必要な画面部品を読み込めませんでした');
    }

    currentState = getCountdownState();
    selectedTrainIndex = Math.abs(Math.floor(dayNumber(currentState.today))) % TRAIN_TYPES.length;
    soundEnabled = safeGetStorage(SOUND_STORAGE_KEY) !== '0';
    document.documentElement.setAttribute('data-motion', reducedMotion ? 'reduce' : 'full');
    if (motionPreference !== 'reduce' && motionPreference !== 'full' && motionMedia) {
      var handleMotionChange = function (event) {
        reducedMotion = Boolean(event.matches);
        document.documentElement.setAttribute('data-motion', reducedMotion ? 'reduce' : 'full');
      };
      if (typeof motionMedia.addEventListener === 'function') motionMedia.addEventListener('change', handleMotionChange);
      else if (typeof motionMedia.addListener === 'function') motionMedia.addListener(handleMotionChange);
    }
    updateTrainSelection(selectedTrainIndex);
    setSoundEnabled(soundEnabled);
    renderCountdown(false);
    bindEvents();
    scheduleMidnightUpdate();
    window.clearTimeout(window.__birthdayBootTimer);
    var bootError = $('#bootError');
    if (bootError) bootError.hidden = true;
    document.documentElement.classList.add('app-ready');

    if (currentState.actualDays === 0) window.setTimeout(function () { makeConfetti(28); }, 550);
    if (window.requestIdleCallback) window.requestIdleCallback(preloadJourneyAssets, { timeout: 1800 });
    else window.setTimeout(preloadJourneyAssets, 800);
  }

  try {
    initialize();
  } catch (error) {
    window.clearTimeout(window.__birthdayBootTimer);
    var message = document.getElementById('bootError');
    if (message) message.hidden = false;
    if (window.console && console.error) console.error(error);
  }
}());
