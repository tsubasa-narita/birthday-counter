interface ActiveSound {
  sources: AudioScheduledSourceNode[];
  intermediateNodes: AudioNode[];
  master: GainNode;
  remainingSources: number;
  cleanupTimer: number | null;
  cleaned: boolean;
}

export class JourneyAudio {
  private context: AudioContext | null = null;
  private active: ActiveSound | null = null;
  private cachedRailNoise: AudioBuffer | null = null;
  private enabled = true;

  private disconnect(node: AudioNode): void {
    try { node.disconnect(); } catch { /* A disconnected audio node is already clean. */ }
  }

  private cleanupSound(sound: ActiveSound): void {
    if (sound.cleaned) return;
    sound.cleaned = true;
    if (sound.cleanupTimer !== null) window.clearTimeout(sound.cleanupTimer);
    sound.sources.forEach((source) => {
      source.onended = null;
      this.disconnect(source);
    });
    sound.intermediateNodes.forEach((node) => this.disconnect(node));
    this.disconnect(sound.master);
    // An older sound can finish after a replay has already installed a new
    // active graph. Never let that delayed cleanup clear the newer sound.
    if (this.active === sound) this.active = null;
  }

  private registerSound(sound: ActiveSound): void {
    const handleEnded = (): void => {
      if (sound.cleaned) return;
      sound.remainingSources -= 1;
      if (sound.remainingSources <= 0) this.cleanupSound(sound);
    };
    sound.sources.forEach((source) => { source.onended = handleEnded; });
    this.active = sound;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.stop();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async unlock(): Promise<void> {
    if (!this.enabled) return;
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    if (!this.context) this.context = new AudioContextClass();
    if (this.context.state === 'suspended') await this.context.resume();
  }

  private railNoiseBuffer(context: AudioContext): AudioBuffer {
    if (this.cachedRailNoise) return this.cachedRailNoise;

    // A long one-shot buffer used to allocate roughly 2.5 MB and generate more
    // than 600,000 random samples synchronously on every departure. A short,
    // seamless-enough filtered loop sounds the same in the mix, but removes
    // that main-thread spike and the later garbage-collection hitch.
    const seconds = 1.5;
    const frames = Math.ceil(context.sampleRate * seconds);
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < frames; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.92 + white * 0.08;
      data[index] = previous;
    }
    // Bring the tail exactly back to the first sample over 80 ms. A quintic
    // blend keeps the taper gradual and makes the seam value-continuous,
    // suppressing the loop-edge click without another realtime audio node.
    const taperFrames = Math.min(frames - 1, Math.floor(context.sampleRate * 0.08));
    const taperStart = frames - taperFrames;
    const firstSample = data[0];
    for (let index = 0; index < taperFrames; index += 1) {
      const amount = (index + 1) / taperFrames;
      const smooth = amount ** 3 * (amount * (amount * 6 - 15) + 10);
      const dataIndex = taperStart + index;
      data[dataIndex] = data[dataIndex] * (1 - smooth) + firstSample * smooth;
    }
    this.cachedRailNoise = buffer;
    return this.cachedRailNoise;
  }

  playDeparture(durationSeconds: number): void {
    if (!this.enabled || !this.context) return;
    this.stop();
    const context = this.context;
    const now = context.currentTime;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.12, now + 0.45);
    master.gain.setValueAtTime(0.12, now + Math.max(0.6, durationSeconds - 1.1));
    master.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);
    master.connect(context.destination);

    const motor = context.createOscillator();
    const motorGain = context.createGain();
    motor.type = 'sine';
    motor.frequency.setValueAtTime(48, now);
    motor.frequency.exponentialRampToValueAtTime(164, now + durationSeconds * 0.58);
    motor.frequency.exponentialRampToValueAtTime(72, now + durationSeconds);
    motorGain.gain.setValueAtTime(0.32, now);
    motorGain.gain.linearRampToValueAtTime(0.16, now + durationSeconds);
    motor.connect(motorGain).connect(master);

    const harmonic = context.createOscillator();
    const harmonicGain = context.createGain();
    harmonic.type = 'triangle';
    harmonic.frequency.setValueAtTime(97, now);
    harmonic.frequency.exponentialRampToValueAtTime(348, now + durationSeconds * 0.62);
    harmonic.frequency.exponentialRampToValueAtTime(128, now + durationSeconds);
    harmonicGain.gain.value = 0.075;
    harmonic.connect(harmonicGain).connect(master);

    const railNoise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    railNoise.buffer = this.railNoiseBuffer(context);
    railNoise.loop = true;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(620, now);
    noiseFilter.frequency.linearRampToValueAtTime(1500, now + durationSeconds * 0.56);
    noiseFilter.frequency.linearRampToValueAtTime(520, now + durationSeconds);
    noiseFilter.Q.value = 0.7;
    noiseGain.gain.value = 0.32;
    railNoise.connect(noiseFilter).connect(noiseGain).connect(master);

    const sources = [motor, harmonic, railNoise];
    const sound: ActiveSound = {
      sources,
      intermediateNodes: [motorGain, harmonicGain, noiseFilter, noiseGain],
      master,
      remainingSources: sources.length,
      cleanupTimer: null,
      cleaned: false,
    };
    this.registerSound(sound);
    sources.forEach((source) => {
      source.start(now);
      source.stop(now + durationSeconds + 0.08);
    });
  }

  playArrival(): void {
    if (!this.enabled || !this.context) return;
    this.stop();
    const context = this.context;
    const now = context.currentTime;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.13, now + 0.04);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.65);
    master.connect(context.destination);
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const oscillators: OscillatorNode[] = [];
    const gains: GainNode[] = [];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * 0.17;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.42, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.72);
      oscillator.connect(gain).connect(master);
      oscillators.push(oscillator);
      gains.push(gain);
      oscillator.start(start);
      oscillator.stop(start + 0.75);
    });
    this.registerSound({
      sources: oscillators,
      intermediateNodes: gains,
      master,
      remainingSources: oscillators.length,
      cleanupTimer: null,
      cleaned: false,
    });
  }

  stop(): void {
    if (!this.active || !this.context) return;
    const sound = this.active;
    // Release the active slot now. onended fires asynchronously, potentially
    // after playDeparture has registered its replacement.
    this.active = null;
    const now = this.context.currentTime;
    try {
      sound.master.gain.cancelScheduledValues(now);
      sound.master.gain.setValueAtTime(Math.max(sound.master.gain.value, 0.0001), now);
      sound.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    } catch { /* Audio cleanup must not block the experience. */ }
    sound.sources.forEach((source) => {
      try { source.stop(now + 0.1); } catch { /* Source already stopped. */ }
    });
    // onended normally performs cleanup; the timer is a defensive fallback
    // for older WebKit implementations that occasionally omit the event.
    sound.cleanupTimer = window.setTimeout(() => this.cleanupSound(sound), 220);
  }
}
