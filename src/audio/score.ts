/**
 * Music and the finale soundscape.
 *
 * Music: three build-up layers crossfaded by intensity (the meter), a finale swell, and a dawn
 * piece. If tracks exist in /music (build_1/2/3.m4a, finale.m4a, dawn.m4a, e.g. from Suno) they
 * are used; otherwise a quiet generative placeholder plays the same roles.
 *
 * Finale soundscape: synthesized phone ringtone, alarm-clock beeps, printer grinding, error
 * chimes, and a buzzing light. Original tones, no recognizable brand sounds.
 */

type Loop = { stop(): void };

export class Score {
  private readonly music: GainNode;
  private readonly fx: GainNode;
  private layers: GainNode[] = [];
  private files: Record<string, AudioBuffer | null> = {};
  private started = false;
  private intensity = 0;
  private generative: { stop(): void } | null = null;
  private loops = new Map<string, Loop>();

  constructor(private readonly ctx: AudioContext, out: AudioNode) {
    this.music = ctx.createGain();
    this.music.gain.value = 0.55;
    this.music.connect(out);
    this.fx = ctx.createGain();
    this.fx.gain.value = 0.5;
    this.fx.connect(out);
    void this.loadFiles();
  }

  private async loadFiles(): Promise<void> {
    const base = `${import.meta.env.BASE_URL}music/`;
    for (const name of ['build_1', 'build_2', 'build_3', 'finale', 'dawn']) {
      try {
        const r = await fetch(`${base}${name}.m4a`);
        const type = r.headers.get('content-type') ?? '';
        if (!r.ok || type.includes('text/html')) {
          this.files[name] = null;
          continue;
        }
        this.files[name] = await this.ctx.decodeAudioData(await r.arrayBuffer());
      } catch {
        this.files[name] = null;
      }
    }
  }

  private get hasStems(): boolean {
    return !!(this.files.build_1 && this.files.build_2 && this.files.build_3);
  }

  /** Starts the build-up music (quiet until intensity rises). */
  start(): void {
    if (this.started) return;
    this.started = true;
    const t = this.ctx.currentTime;
    if (this.hasStems) {
      this.layers = (['build_1', 'build_2', 'build_3'] as const).map((n) => {
        const src = this.ctx.createBufferSource();
        src.buffer = this.files[n]!;
        src.loop = true;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        src.connect(g).connect(this.music);
        src.start(t + 0.05);
        return g;
      });
    } else {
      this.generative = this.startGenerative();
    }
    this.setIntensity(0);
  }

  /** 0..1: which layers are audible. */
  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
    const t = this.ctx.currentTime;
    const levels = [0.55 + this.intensity * 0.3, smooth(this.intensity, 0.25, 0.6), smooth(this.intensity, 0.6, 0.95)];
    this.layers.forEach((g, i) => g.gain.setTargetAtTime(levels[i], t, 0.8));
  }

  /** Cuts the build-up music (the finale's silence). */
  stopMusic(fade = 0.05): void {
    const t = this.ctx.currentTime;
    this.music.gain.setTargetAtTime(0, t, fade);
    this.generative?.stop();
    this.generative = null;
  }

  /** The swell under the charged swing. */
  swell(): void {
    const f = this.files.finale;
    if (f) {
      const src = this.ctx.createBufferSource();
      src.buffer = f;
      src.connect(this.fx);
      src.start();
      return;
    }
    // Placeholder: a rising detuned chord with a noise riser.
    const t = this.ctx.currentTime;
    for (const freq of [55, 82.4, 110, 164.8]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 2.2);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(200, t);
      lp.frequency.exponentialRampToValueAtTime(3000, t + 2.2);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 2.0);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      o.connect(lp).connect(g).connect(this.fx);
      o.start(t);
      o.stop(t + 2.7);
    }
  }

  /** The dawn piece. */
  dawn(): void {
    this.music.gain.cancelScheduledValues(this.ctx.currentTime);
    this.music.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    this.music.gain.exponentialRampToValueAtTime(0.5, this.ctx.currentTime + 4);
    const f = this.files.dawn;
    if (f) {
      const src = this.ctx.createBufferSource();
      src.buffer = f;
      src.connect(this.music);
      src.start();
      return;
    }
    // Placeholder: slow, soft chords with bell-like notes.
    const chords = [
      [261.6, 329.6, 392.0, 493.9],
      [220.0, 261.6, 329.6, 392.0],
      [174.6, 220.0, 261.6, 349.2],
      [196.0, 246.9, 293.7, 392.0],
    ];
    const t0 = this.ctx.currentTime + 0.3;
    chords.forEach((chord, ci) => {
      chord.forEach((f, ni) => {
        const t = t0 + ci * 4 + ni * 0.35;
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const o2 = this.ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = f * 2.001;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
        const g2 = this.ctx.createGain();
        g2.gain.value = 0.25;
        o.connect(g);
        o2.connect(g2).connect(g);
        g.connect(this.music);
        o.start(t);
        o2.start(t);
        o.stop(t + 4.6);
        o2.stop(t + 4.6);
      });
    });
  }

  // --- Finale soundscape ----------------------------------------------------------------------

  /** Starts a named alarm loop: 'ring' | 'alarm' | 'grind' | 'chimes' | 'buzz'. */
  startLoop(name: 'ring' | 'alarm' | 'grind' | 'chimes' | 'buzz'): void {
    if (this.loops.has(name)) return;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = name === 'grind' ? 0.35 : name === 'buzz' ? 0.12 : 0.22;
    out.connect(this.fx);
    let timer = 0;
    const nodes: AudioScheduledSourceNode[] = [];
    const beep = (freq: number, at: number, dur: number, type: OscillatorType, vol = 1) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
      g.gain.setValueAtTime(vol, at + dur - 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + dur + 0.02);
    };
    if (name === 'ring') {
      // Two-tone trill, ring-ring, pause.
      const pattern = () => {
        const t = ctx.currentTime + 0.02;
        for (let i = 0; i < 2; i++) for (let k = 0; k < 10; k++) beep(k % 2 ? 1180 : 940, t + i * 0.55 + k * 0.04, 0.04, 'triangle', 0.6);
      };
      pattern();
      timer = window.setInterval(pattern, 2200);
    } else if (name === 'alarm') {
      const pattern = () => {
        const t = ctx.currentTime + 0.02;
        for (let k = 0; k < 4; k++) beep(2050, t + k * 0.12, 0.07, 'square', 0.25);
      };
      pattern();
      timer = window.setInterval(pattern, 900);
    } else if (name === 'grind') {
      const noise = ctx.createBufferSource();
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (0.5 + 0.5 * Math.sin(i / 900));
      noise.buffer = buf;
      noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 700;
      bp.Q.value = 2;
      const motor = ctx.createOscillator();
      motor.type = 'sawtooth';
      motor.frequency.value = 62;
      const mg = ctx.createGain();
      mg.gain.value = 0.25;
      noise.connect(bp).connect(out);
      motor.connect(mg).connect(out);
      noise.start();
      motor.start();
      nodes.push(noise, motor);
    } else if (name === 'chimes') {
      const pattern = () => {
        const t = ctx.currentTime + Math.random() * 0.3;
        beep(660, t, 0.12, 'sine', 0.5);
        beep(523, t + 0.13, 0.22, 'sine', 0.5);
      };
      pattern();
      timer = window.setInterval(pattern, 480);
    } else if (name === 'buzz') {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 100;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      o.connect(lp).connect(out);
      o.start();
      nodes.push(o);
    }
    this.loops.set(name, {
      stop: () => {
        window.clearInterval(timer);
        const t = ctx.currentTime;
        out.gain.setTargetAtTime(0, t, 0.02);
        nodes.forEach((n) => n.stop(t + 0.1));
      },
    });
  }

  stopAllLoops(): void {
    this.loops.forEach((l) => l.stop());
    this.loops.clear();
  }

  // --- Generative placeholder for the build-up ------------------------------------------------

  private startGenerative(): { stop(): void } {
    const ctx = this.ctx;
    const layerGains = [0, 1, 2].map(() => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.music);
      return g;
    });
    this.layers = layerGains;
    // Layer 1: a slow sub pulse and drone.
    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 41.2;
    const dg = ctx.createGain();
    dg.gain.value = 0.25;
    drone.connect(dg).connect(layerGains[0]);
    drone.start();
    const bpm = 76;
    const beat = 60 / bpm;
    let next = ctx.currentTime + 0.1;
    let step = 0;
    const kick = (t: number, v: number) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(layerGains[0]);
      o.start(t);
      o.stop(t + 0.32);
    };
    const hat = (t: number) => {
      const len = Math.floor(ctx.sampleRate * 0.05);
      const b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = ctx.createBufferSource();
      s.buffer = b;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.value = 0.12;
      s.connect(hp).connect(g).connect(layerGains[1]);
      s.start(t);
    };
    const bass = (t: number, f: number) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.9);
      o.connect(lp).connect(g).connect(layerGains[1]);
      o.start(t);
      o.stop(t + beat);
    };
    const pad = (t: number, freqs: number[]) => {
      for (const f of freqs) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = (Math.random() - 0.5) * 14;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1400;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.035, t + beat * 2);
        g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 8);
        o.connect(lp).connect(g).connect(layerGains[2]);
        o.start(t);
        o.stop(t + beat * 8.2);
      }
    };
    const bassLine = [41.2, 41.2, 49.0, 36.7];
    const timer = window.setInterval(() => {
      while (next < ctx.currentTime + 0.3) {
        if (step % 4 === 0) kick(next, 0.45);
        if (step % 4 === 2) kick(next, 0.25);
        hat(next + beat / 2);
        if (step % 2 === 0) bass(next, bassLine[Math.floor(step / 8) % 4] * 2);
        if (step % 16 === 0) pad(next, [164.8, 196.0, 246.9].map((f) => f * (Math.floor(step / 16) % 2 ? 0.89 : 1)));
        next += beat;
        step++;
      }
    }, 100);
    return {
      stop: () => {
        window.clearInterval(timer);
        drone.stop();
      },
    };
  }
}

function smooth(x: number, a: number, b: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
