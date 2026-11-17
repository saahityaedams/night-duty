/** Rolling frame-time statistics, read by automated performance tests. */
export class FrameStats {
  private readonly samples: Float32Array;
  private index = 0;
  private count = 0;

  constructor(capacity = 600) {
    this.samples = new Float32Array(capacity);
  }

  push(frameMs: number): void {
    this.samples[this.index] = frameMs;
    this.index = (this.index + 1) % this.samples.length;
    this.count = Math.min(this.count + 1, this.samples.length);
  }

  reset(): void {
    this.index = 0;
    this.count = 0;
  }

  summary(): { frames: number; p50: number; p95: number; max: number } {
    if (this.count === 0) return { frames: 0, p50: 0, p95: 0, max: 0 };
    const sorted = Array.from(this.samples.subarray(0, this.count)).sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { frames: this.count, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
  }
}
