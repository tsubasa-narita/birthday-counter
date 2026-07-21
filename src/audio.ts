interface ActiveSound {
  sources: AudioScheduledSourceNode[];
  master: GainNode;
}

export class JourneyAudio {
  private context: AudioContext | null = null;
  private active: ActiveSound | null = null;
  private enabled = true;

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

  private noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
    const frames = Math.ceil(context.sampleRate * seconds);
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < frames; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.92 + white * 0.08;
      data[index] = previous;
    }
    return buffer;
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
    railNoise.buffer = this.noiseBuffer(context, durationSeconds + 0.1);
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(620, now);
    noiseFilter.frequency.linearRampToValueAtTime(1500, now + durationSeconds * 0.56);
    noiseFilter.frequency.linearRampToValueAtTime(520, now + durationSeconds);
    noiseFilter.Q.value = 0.7;
    noiseGain.gain.value = 0.32;
    railNoise.connect(noiseFilter).connect(noiseGain).connect(master);

    [motor, harmonic, railNoise].forEach((source) => {
      source.start(now);
      source.stop(now + durationSeconds + 0.08);
    });
    this.active = { sources: [motor, harmonic, railNoise], master };
  }

  playArrival(): void {
    if (!this.enabled || !this.context) return;
    const context = this.context;
    const now = context.currentTime;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.13, now + 0.04);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.65);
    master.connect(context.destination);
    const notes = [523.25, 659.25, 783.99, 1046.5];
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
      oscillator.start(start);
      oscillator.stop(start + 0.75);
    });
  }

  stop(): void {
    if (!this.active || !this.context) return;
    const now = this.context.currentTime;
    try {
      this.active.master.gain.cancelScheduledValues(now);
      this.active.master.gain.setValueAtTime(Math.max(this.active.master.gain.value, 0.0001), now);
      this.active.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      this.active.sources.forEach((source) => {
        try { source.stop(now + 0.1); } catch { /* Source already stopped. */ }
      });
    } catch { /* Audio cleanup must not block the experience. */ }
    this.active = null;
  }
}
