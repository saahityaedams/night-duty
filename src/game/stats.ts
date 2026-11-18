/**
 * What she did in a session (for the ending), plus a lifetime count kept on her phone.
 * Storage is best-effort: private browsing or blocked storage just means no lifetime count.
 */

export interface SessionStats {
  cups: number;
  pages: number;
  popups: number;
  calls: number;
  things: number;
}

const KEY = 'nightduty.v1';

interface Saved {
  lifetime: number;
  endings: number;
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Saved>;
      return { lifetime: Number(v.lifetime) || 0, endings: Number(v.endings) || 0 };
    }
  } catch {
    /* unavailable */
  }
  return { lifetime: 0, endings: 0 };
}

function save(s: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* unavailable */
  }
}

export class Stats {
  readonly session: SessionStats = { cups: 0, pages: 0, popups: 0, calls: 0, things: 0 };
  private saved = load();
  /** Lifetime count at the start of this session (for the "returning" line). */
  readonly lifetimeAtStart = this.saved.lifetime;
  readonly endingsAtStart = this.saved.endings;

  add(key: keyof SessionStats, n = 1): void {
    this.session[key] += n;
  }

  /** Records the session at the ending: lifetime things broken and one more ending seen. */
  commit(): void {
    this.saved = { lifetime: this.saved.lifetime + this.session.things, endings: this.saved.endings + 1 };
    save(this.saved);
  }

  get lifetime(): number {
    return this.saved.lifetime;
  }
}
