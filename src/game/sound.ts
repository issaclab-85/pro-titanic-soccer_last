class SoccerAudioEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private musicEnabled = true;
  private ambienceEnabled = true;

  // Continuous stadium atmosphere nodes
  private ambienceGain: GainNode | null = null;
  private ambienceFilter: BiquadFilterNode | null = null;
  private ambienceSource: AudioBufferSourceNode | null = null;
  private windSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private ambienceActive = false;
  private currentExcitement = 0.22;

  // Menu music sequencer
  private menuTimer: number | null = null;
  private menuStep = 0;
  private menuPlaying = false;
  private desiredMode: 'none' | 'menu' | 'stadium' = 'none';
  private unlockListenerBound = false;
  private backgrounded = false;

  private bindUnlockListener() {
    if (this.unlockListenerBound || typeof window === 'undefined') return;
    this.unlockListenerBound = true;
    const unlock = () => {
      if (this.backgrounded || this.muted) return;
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume().then(() => {
          this.syncActiveLoops();
        });
      } else {
        this.syncActiveLoops();
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  private ensureContext(createIfMissing = true): AudioContext | null {
    if (this.muted || this.backgrounded || typeof window === 'undefined') return null;
    this.bindUnlockListener();
    if (!this.ctx && createIfMissing) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (!this.ctx) return null;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(() => this.syncActiveLoops());
    }
    return this.ctx;
  }

  private syncActiveLoops() {
    if (this.muted || this.backgrounded || !this.ctx || this.ctx.state !== 'running') return;
    if (this.desiredMode === 'menu' && this.musicEnabled && !this.menuPlaying) {
      this.beginMenuSequencer();
    }
    if (this.desiredMode === 'stadium' && this.ambienceEnabled && !this.ambienceActive) {
      this.beginStadiumAmbience();
    }
  }

  public setAppBackgrounded(bg: boolean) {
    this.backgrounded = bg;
    if (bg) {
      this.haltMenuSequencer();
      this.haltStadiumAmbience();
      if (this.ctx && this.ctx.state === 'running') {
        void this.ctx.suspend().catch(() => {
          // ignore WebAudio suspend errors
        });
      }
    } else if (!this.muted) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx
          .resume()
          .then(() => this.syncActiveLoops())
          .catch(() => {
            // waiting for user gesture to resume
          });
      } else {
        this.syncActiveLoops();
      }
    }
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      this.haltMenuSequencer();
      this.haltStadiumAmbience();
    } else if (!this.backgrounded) {
      this.ensureContext(true);
      this.syncActiveLoops();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    if (!enabled) {
      this.haltMenuSequencer();
    } else if (this.desiredMode === 'menu' && !this.backgrounded) {
      this.startMenuMusic();
    }
  }

  public setAmbienceEnabled(enabled: boolean) {
    this.ambienceEnabled = enabled;
    if (!enabled) {
      this.haltStadiumAmbience();
    } else if (this.desiredMode === 'stadium' && !this.backgrounded) {
      this.startStadiumAmbience();
    }
  }

  // ------------------------------------------------------------------
  // HOME SCREEN SPORTS MENU MUSIC (Energetic Web Audio Synth Groove)
  // ------------------------------------------------------------------
  public startMenuMusic() {
    this.desiredMode = 'menu';
    this.haltStadiumAmbience();
    if (this.muted || this.backgrounded || !this.musicEnabled) return;
    const ctx = this.ensureContext(true);
    if (!ctx || ctx.state !== 'running') return;
    if (!this.menuPlaying) {
      this.beginMenuSequencer();
    }
  }

  public stopMenuMusic() {
    if (this.desiredMode === 'menu') {
      this.desiredMode = 'none';
    }
    this.haltMenuSequencer();
  }

  private beginMenuSequencer() {
    if (this.menuPlaying || typeof window === 'undefined') return;
    this.menuPlaying = true;
    this.menuStep = 0;

    // 122 BPM 16th-note pulse (~123ms per step)
    const bassPattern = [110, 0, 110, 0, 130.81, 0, 146.83, 0, 98, 0, 98, 0, 110, 0, 130.81, 146.83];
    const leadPattern = [440, 0, 523.25, 0, 659.25, 0, 587.33, 523.25, 392, 0, 440, 0, 523.25, 0, 659.25, 783.99];
    const chordRoots = [220, 261.63, 196, 220];

    const tickStep = () => {
      if (!this.menuPlaying || this.muted || !this.musicEnabled) return;
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;

      const step = this.menuStep % 16;
      const now = ctx.currentTime;

      // Kick on 0, 4, 8, 12
      if (step % 4 === 0) {
        const kick = ctx.createOscillator();
        const kGain = ctx.createGain();
        kick.type = 'sine';
        kick.frequency.setValueAtTime(118, now);
        kick.frequency.exponentialRampToValueAtTime(42, now + 0.11);
        kGain.gain.setValueAtTime(0.085, now);
        kGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        kick.connect(kGain);
        kGain.connect(ctx.destination);
        kick.start(now);
        kick.stop(now + 0.15);
      }

      // Crisp off-beat hi-hat on 2, 6, 10, 14
      if (step % 4 === 2) {
        const hatLen = Math.floor(ctx.sampleRate * 0.04);
        const buf = ctx.createBuffer(1, hatLen, ctx.sampleRate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < hatLen; i++) {
          ch[i] = (Math.random() * 2 - 1) * (1 - i / hatLen);
        }
        const hat = ctx.createBufferSource();
        hat.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(6500, now);
        const hGain = ctx.createGain();
        hGain.gain.setValueAtTime(0.025, now);
        hGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        hat.connect(hp);
        hp.connect(hGain);
        hGain.connect(ctx.destination);
        hat.start(now);
      }

      // Driving bass pulse
      const bassFreq = bassPattern[step];
      if (bassFreq > 0) {
        const bass = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const bGain = ctx.createGain();
        bass.type = 'sawtooth';
        bass.frequency.setValueAtTime(bassFreq, now);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(420, now);
        bGain.gain.setValueAtTime(0.045, now);
        bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        bass.connect(filter);
        filter.connect(bGain);
        bGain.connect(ctx.destination);
        bass.start(now);
        bass.stop(now + 0.19);
      }

      // Stadium pad chord hit every 4 steps
      if (step % 4 === 0) {
        const root = chordRoots[Math.floor(step / 4) % chordRoots.length];
        [root, root * 1.25, root * 1.5].forEach((freq) => {
          const pad = ctx.createOscillator();
          const pGain = ctx.createGain();
          pad.type = 'triangle';
          pad.frequency.setValueAtTime(freq, now);
          pGain.gain.setValueAtTime(0.001, now);
          pGain.gain.linearRampToValueAtTime(0.016, now + 0.05);
          pGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
          pad.connect(pGain);
          pGain.connect(ctx.destination);
          pad.start(now);
          pad.stop(now + 0.46);
        });
      }

      // Uplifting sports synth arpeggio lead
      const leadFreq = leadPattern[step];
      if (leadFreq > 0 && Math.floor(this.menuStep / 16) % 2 === 1) {
        const lead = ctx.createOscillator();
        const lGain = ctx.createGain();
        lead.type = 'triangle';
        lead.frequency.setValueAtTime(leadFreq, now);
        lGain.gain.setValueAtTime(0.022, now);
        lGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        lead.connect(lGain);
        lGain.connect(ctx.destination);
        lead.start(now);
        lead.stop(now + 0.17);
      }

      this.menuStep += 1;
    };

    tickStep();
    this.menuTimer = window.setInterval(tickStep, 128);
  }

  private haltMenuSequencer() {
    this.menuPlaying = false;
    if (this.menuTimer !== null) {
      clearInterval(this.menuTimer);
      this.menuTimer = null;
    }
  }

  // ------------------------------------------------------------------
  // CONTINUOUS STADIUM ATMOSPHERE & DYNAMIC CROWD EXCITEMENT
  // ------------------------------------------------------------------
  public startStadiumAmbience() {
    this.desiredMode = 'stadium';
    this.haltMenuSequencer();
    if (this.muted || !this.ambienceEnabled) return;
    const ctx = this.ensureContext(true);
    if (!ctx || ctx.state !== 'running') return;
    if (!this.ambienceActive) {
      this.beginStadiumAmbience();
    }
  }

  public stopStadiumAmbience() {
    if (this.desiredMode === 'stadium') {
      this.desiredMode = 'none';
    }
    this.haltStadiumAmbience();
  }

  private beginStadiumAmbience() {
    const ctx = this.ctx;
    if (!ctx || this.ambienceActive) return;
    this.ambienceActive = true;

    // 3-second seamless pink-tinted crowd noise loop
    const crowdLen = ctx.sampleRate * 3;
    const crowdBuf = ctx.createBuffer(1, crowdLen, ctx.sampleRate);
    const crowdData = crowdBuf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < crowdLen; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.95 * b2 + white * 0.048;
      // Smooth loop crossfade near ends
      const env =
        i < 1200
          ? i / 1200
          : i > crowdLen - 1200
            ? (crowdLen - i) / 1200
            : 1;
      crowdData[i] = (b0 + b1 + b2) * 0.36 * env;
    }

    const crowdSrc = ctx.createBufferSource();
    crowdSrc.buffer = crowdBuf;
    crowdSrc.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(520, ctx.currentTime);
    filter.Q.setValueAtTime(0.65, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.045, ctx.currentTime);

    crowdSrc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    crowdSrc.start();

    // Subtle open-air stadium wind bed
    const windLen = ctx.sampleRate * 2;
    const windBuf = ctx.createBuffer(1, windLen, ctx.sampleRate);
    const windData = windBuf.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < windLen; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      windData[i] = lastOut * 1.8;
    }
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = windBuf;
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.setValueAtTime(240, ctx.currentTime);
    const windGain = ctx.createGain();
    windGain.gain.setValueAtTime(0.025, ctx.currentTime);

    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(ctx.destination);
    windSrc.start();

    this.ambienceSource = crowdSrc;
    this.ambienceFilter = filter;
    this.ambienceGain = gain;
    this.windSource = windSrc;
    this.windGain = windGain;
    this.setCrowdExcitement(this.currentExcitement);
  }

  private haltStadiumAmbience() {
    this.ambienceActive = false;
    try {
      this.ambienceSource?.stop();
      this.ambienceSource?.disconnect();
    } catch {
      // ignore
    }
    try {
      this.windSource?.stop();
      this.windSource?.disconnect();
    } catch {
      // ignore
    }
    this.ambienceSource = null;
    this.ambienceFilter = null;
    this.ambienceGain = null;
    this.windSource = null;
    this.windGain = null;
  }

  public setCrowdExcitement(level: number) {
    this.currentExcitement = Math.max(0.15, Math.min(1, level));
    if (!this.ctx || !this.ambienceGain || !this.ambienceFilter || !this.ambienceActive) return;
    const now = this.ctx.currentTime;
    const targetGain = 0.032 + this.currentExcitement * 0.135;
    const targetFreq = 380 + this.currentExcitement * 820;
    this.ambienceGain.gain.setTargetAtTime(targetGain, now, 0.25);
    this.ambienceFilter.frequency.setTargetAtTime(targetFreq, now, 0.25);
    if (this.windGain) {
      this.windGain.gain.setTargetAtTime(0.02 + this.currentExcitement * 0.015, now, 0.3);
    }
  }

  // ------------------------------------------------------------------
  // BALL STRIKING & MATCH SFX
  // ------------------------------------------------------------------
  public playPass(kind: 'grounded' | 'through' | 'lofted') {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (kind === 'grounded') {
      // Crisp short leather tap
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(175, now);
      osc.frequency.exponentialRampToValueAtTime(52, now + 0.085);
      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (kind === 'through') {
      // Driven snappy pass
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(210, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.11);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.125);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.13);
    } else {
      // Lofted Pass: deeper hollow boom + airy whoosh
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(34, now + 0.16);
      gain.gain.setValueAtTime(0.34, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.19);
      this.playAirLayer(ctx, now, 420, 0.11);
    }
  }

  public playShot() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Heavy sub-bass cannon + sharp leather strike
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(220, now);
    sub.frequency.exponentialRampToValueAtTime(32, now + 0.16);
    subGain.gain.setValueAtTime(0.42, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.19);

    this.playAirLayer(ctx, now, 950, 0.14);
  }

  private playAirLayer(ctx: AudioContext, now: number, filterHz: number, volume: number) {
    const len = Math.floor(ctx.sampleRate * 0.14);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterHz, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
  }

  public playKick(power = 0.6) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const clampedPower = Math.min(1.2, Math.max(0.25, power));

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(145 * (0.8 + clampedPower * 0.4), now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.11);

    gain.gain.setValueAtTime(0.32 * clampedPower, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  public playWhistle(
    kind: 'kickoff' | 'goal' | 'fulltime' | 'foul' | 'halftime' | 'penalty' | 'setpiece' = 'kickoff',
  ) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const bursts =
      kind === 'fulltime'
        ? [0, 0.24, 0.52]
        : kind === 'halftime'
          ? [0, 0.28]
          : kind === 'goal'
            ? [0, 0.2]
            : kind === 'foul'
              ? [0, 0.18]
              : [0];
    const dur =
      kind === 'fulltime'
        ? 0.2
        : kind === 'foul'
          ? 0.34
          : kind === 'setpiece'
            ? 0.18
            : kind === 'penalty'
              ? 0.32
              : 0.28;

    for (const offset of bursts) {
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(kind === 'foul' ? 2980 : 2850, now + offset);

      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(42, now + offset);
      lfoGain.gain.setValueAtTime(95, now + offset);

      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.linearRampToValueAtTime(0.14, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      lfo.start(now + offset);
      osc.start(now + offset);
      lfo.stop(now + offset + dur + 0.02);
      osc.stop(now + offset + dur + 0.02);
    }
  }

  public playPostClang() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    [520, 780, 1140, 1620].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.16 / (i + 1), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.43);
    });
  }

  public playDiveWhoosh() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * 0.22);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(650, now);
    filter.frequency.exponentialRampToValueAtTime(220, now + 0.2);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
  }

  public playCrowdGoalRoar() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * 2.1);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = Math.sin((i / bufferSize) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1250, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 0.24);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.08);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);

    // Goal horn chord celebratory swell
    [220, 277.18, 329.63].forEach((freq) => {
      const horn = ctx.createOscillator();
      const hGain = ctx.createGain();
      horn.type = 'sawtooth';
      horn.frequency.setValueAtTime(freq, now);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(680, now);
      hGain.gain.setValueAtTime(0.001, now);
      hGain.gain.linearRampToValueAtTime(0.032, now + 0.14);
      hGain.gain.exponentialRampToValueAtTime(0.001, now + 1.25);
      horn.connect(lp);
      lp.connect(hGain);
      hGain.connect(ctx.destination);
      horn.start(now);
      horn.stop(now + 1.28);
    });
  }

  public playCoinToss() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    [980, 1420].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.14, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.36);
    });
  }
}

export const soccerAudio = new SoccerAudioEngine();
