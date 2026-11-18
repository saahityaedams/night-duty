/**
 * Audio engine.
 * - One AudioContext, unlocked on the first touch (required on iPhone; the first touch is the
 *   first smash, so nothing is lost).
 * - Recorded one-shots (breaks, debris, clinks), each loudness-balanced at load time and played
 *   with random variation in pitch, volume and choice so no two breaks sound identical.
 * - Synthesized layers: a low body thump for weight, rain and room tone for ambience.
 * - A bus compressor keeps big moments loud without clipping.
 */

type Category = 'break' | 'debris' | 'clink' | 'glass' | 'metal' | 'plastic' | 'paper' | 'spark';
const COUNTS: Record<Category, number> = { break: 18, debris: 3, clink: 3, glass: 8, metal: 6, plastic: 7, paper: 5, spark: 3 };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ambience!: GainNode;
  private readonly buffers: Record<Category, { buf: AudioBuffer; gain: number }[]> = {
    break: [],
    debris: [],
    clink: [],
    glass: [],
    metal: [],
    plastic: [],
    paper: [],
    spark: [],
  };
  private readonly lastPick: Partial<Record<Category, number>> = {};
  private loaded = false;
  private clinkTimes: number[] = [];
  private ambienceStarted = false;
  muted = false;

  /** Call from inside a user gesture (pointerdown). Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.build();
      void this.load();
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) void this.ctx.suspend();
        else void this.ctx.resume();
      });
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
    // iOS: playing a silent buffer inside the gesture fully unlocks output.
    const s = this.ctx.createBufferSource();
    s.buffer = this.ctx.createBuffer(1, 1, 22050);
    s.connect(this.ctx.destination);
    s.start();
    if (!this.ambienceStarted) {
      this.ambienceStarted = true;
      this.startAmbience();
    }
  }

  private build(): void {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.sfx = ctx.createGain();
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.0;
    this.sfx.connect(comp);
    this.ambience.connect(this.master);
    comp.connect(this.master);
    this.master.connect(ctx.destination);
  }

  private async load(): Promise<void> {
    const ctx = this.ctx!;
    const base = `${import.meta.env.BASE_URL}audio/`;
    const jobs: Promise<void>[] = [];
    for (const cat of Object.keys(COUNTS) as Category[]) {
      for (let i = 0; i < COUNTS[cat]; i++) {
        const url = `${base}${cat}_${String(i).padStart(2, '0')}.m4a`;
        jobs.push(
          fetch(url)
            .then((r) => r.arrayBuffer())
            .then((ab) => ctx.decodeAudioData(ab))
            .then((buf) => {
              this.buffers[cat].push({ buf, gain: balance(buf) });
            })
            .catch(() => {
              /* a missing sample just isn't played */
            }),
        );
      }
    }
    await Promise.all(jobs);
    this.loaded = true;
  }

  get ready(): boolean {
    return this.loaded;
  }

  /** Diagnostics for tests. */
  info(): { state: string; loaded: boolean; samples: Record<string, number> } {
    return {
      state: this.ctx?.state ?? 'none',
      loaded: this.loaded,
      samples: Object.fromEntries(Object.entries(this.buffers).map(([k, v]) => [k, v.length])),
    };
  }

  private pick(cat: Category): { buf: AudioBuffer; gain: number } | null {
    const list = this.buffers[cat];
    if (!list.length) return null;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.lastPick[cat]) i = (i + 1) % list.length;
    this.lastPick[cat] = i;
    return list[i];
  }

  private play(cat: Category, volume: number, rate: number, pan: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const s = this.pick(cat);
    if (!s) return;
    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = volume * s.gain;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(g).connect(p).connect(this.sfx);
    src.start(ctx.currentTime + delay);
  }

  /** A low, short body thump that gives impacts weight on phone speakers and headphones. */
  private thump(volume: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volume, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** A mug breaking. severity 0..1, pan -1..1 from screen position. */
  breakMug(severity: number, pan: number): void {
    const v = 0.55 + severity * 0.45;
    const rate = 0.92 + Math.random() * 0.16 - severity * 0.05;
    this.play('break', v, rate, pan * 0.6);
    // A second, overlapping break on big hits makes it fuller.
    if (severity > 0.45) this.play('break', v * 0.55, rate * (0.9 + Math.random() * 0.15), pan * 0.6 + (Math.random() - 0.5) * 0.4, 0.015);
    this.thump(0.35 + severity * 0.45);
    this.play('debris', 0.25 + severity * 0.35, 0.95 + Math.random() * 0.15, pan * 0.5, 0.16 + Math.random() * 0.12);
  }

  /** A shard or object hitting something. force in newtons from the physics contact. */
  clink(force: number, pan: number, small = true): void {
    const now = performance.now();
    this.clinkTimes = this.clinkTimes.filter((t) => now - t < 1000);
    if (this.clinkTimes.length > 14) return;
    this.clinkTimes.push(now);
    const v = Math.min(0.5, 0.05 + force / 60);
    this.play('clink', v, (small ? 1.25 : 0.95) + Math.random() * 0.35, pan * 0.6);
  }

  /** A room object breaking, layered by material. */
  breakObject(material: string, severity: number, pan: number): void {
    const v = 0.6 + severity * 0.4;
    const r = () => 0.92 + Math.random() * 0.16;
    switch (material) {
      case 'glass':
        this.play('glass', v, r(), pan * 0.6);
        this.play('glass', v * 0.35, r() * 1.3, pan * 0.6, 0.09); // tinkle tail
        this.thump(0.35 + severity * 0.3);
        break;
      case 'metal':
        this.play('metal', v, r() * 0.9, pan * 0.6);
        this.play('metal', v * 0.5, r() * 0.7, pan * 0.6, 0.05);
        this.thump(0.85);
        break;
      case 'electronics':
        this.play('plastic', v, r() * 0.85, pan * 0.6);
        this.play('spark', v * 0.7, r(), pan * 0.6, 0.04);
        this.thump(0.6 + severity * 0.3);
        break;
      case 'paper':
        this.play('paper', v, r(), pan * 0.6);
        this.play('paper', v * 0.6, r() * 0.9, pan * 0.6, 0.18);
        break;
      case 'plastic':
        this.play('plastic', v, r() * 0.9, pan * 0.6);
        this.play('paper', v * 0.4, r(), pan * 0.6, 0.15); // printers shed paper
        this.thump(0.5 + severity * 0.3);
        break;
      default:
        this.play('break', v, r(), pan * 0.6);
        this.thump(0.45 + severity * 0.3);
    }
  }

  /** A room object taking a hit without breaking. */
  hitObject(material: string, strength: number, pan: number): void {
    const v = 0.3 + strength * 0.45;
    switch (material) {
      case 'glass':
        this.play('glass', v * 0.45, 1.3 + Math.random() * 0.2, pan * 0.6); // a crack, not a shatter
        this.thump(0.2 + strength * 0.3);
        break;
      case 'metal':
        this.play('metal', v, 0.85 + Math.random() * 0.2, pan * 0.6);
        this.thump(0.4 + strength * 0.4);
        break;
      case 'paper':
        this.play('paper', v * 0.7, 1 + Math.random() * 0.2, pan * 0.6);
        break;
      case 'electronics':
        this.play('plastic', v, 0.8 + Math.random() * 0.2, pan * 0.6);
        if (Math.random() < 0.4) this.play('spark', v * 0.5, 1, pan * 0.6, 0.03);
        this.thump(0.3 + strength * 0.4);
        break;
      default:
        this.play('plastic', v, 0.9 + Math.random() * 0.2, pan * 0.6);
        this.thump(0.25 + strength * 0.35);
    }
  }

  /** Mug knocked or set down without breaking: a short ceramic knock. */
  knock(force: number, pan: number): void {
    this.play('clink', Math.min(0.6, 0.12 + force / 50), 0.75 + Math.random() * 0.15, pan * 0.6);
  }

  // --- Ambience ----------------------------------------------------------------------------

  private startAmbience(): void {
    const ctx = this.ctx!;
    // Rain: looping noise, band-limited, with a slow swell.
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0,
        b1 = 0,
        b2 = 0;
      for (let i = 0; i < len; i++) {
        // Pinkish noise (Paul Kellet's economy filter).
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
        // Sparse droplets hitting the glass.
        if (Math.random() < 0.0009) {
          const amp = 0.25 + Math.random() * 0.35;
          for (let k = 0; k < 300 && i + k < len; k++) d[i + k] += Math.sin(k * (0.5 + Math.random() * 0.02)) * amp * Math.exp(-k / 40);
        }
      }
      // Cross-fade the loop ends.
      const xf = 2000;
      for (let i = 0; i < xf; i++) {
        const k = i / xf;
        d[i] = d[i] * k + d[len - xf + i] * (1 - k);
      }
    }
    const rain = ctx.createBufferSource();
    rain.buffer = buf;
    rain.loop = true;
    rain.loopStart = 2000 / ctx.sampleRate;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0.55;
    rain.connect(bp).connect(lp).connect(rainGain).connect(this.ambience);
    rain.start();

    // Room tone: the faint hum of a building at night.
    const hum = ctx.createOscillator();
    hum.frequency.value = 50;
    const hum2 = ctx.createOscillator();
    hum2.frequency.value = 100;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.012;
    hum.connect(humGain);
    hum2.connect(humGain);
    humGain.connect(this.ambience);
    hum.start();
    hum2.start();

    // Fade the ambience in gently.
    const t = ctx.currentTime;
    this.ambience.gain.setValueAtTime(0, t);
    this.ambience.gain.linearRampToValueAtTime(0.35, t + 2.5);
  }
}

/** Gain that brings a sample's transient loudness to a common level. */
function balance(buf: AudioBuffer): number {
  const d = buf.getChannelData(0);
  const n = Math.min(d.length, Math.floor(buf.sampleRate * 0.15));
  let sum = 0;
  for (let i = 0; i < n; i++) sum += d[i] * d[i];
  const rms = Math.sqrt(sum / Math.max(1, n));
  const target = 0.22;
  return Math.max(0.3, Math.min(2.2, target / Math.max(1e-4, rms)));
}
