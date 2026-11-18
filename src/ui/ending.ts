import { TEXT, PERSONAL_MESSAGE, PERSONAL_SIGNATURE } from '../content/text';
import type { SessionStats } from '../game/stats';

/**
 * The ending: stats counting up one at a time, the last line alone, an optional personal
 * message, then two choices. Plus the quiet extras: the goodnight screen, the home-screen hint,
 * and the "returning" line at the start of a later session.
 */

export interface EndingCallbacks {
  onTick(): void;
  onAgain(): void;
  onSleep(): void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class EndingUi {
  private readonly root: HTMLDivElement;

  constructor(private readonly stage: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'ending';
    stage.appendChild(this.root);
  }

  async show(stats: SessionStats, opts: { homeHint: string | null }, cb: EndingCallbacks): Promise<void> {
    const r = this.root;
    r.innerHTML = '';
    r.classList.add('on');
    const list = document.createElement('div');
    list.className = 'stats';
    r.appendChild(list);
    const rows: [string, number][] = [
      [TEXT.stats.cups, stats.cups],
      [TEXT.stats.pages, stats.pages],
      [TEXT.stats.popups, stats.popups],
      [TEXT.stats.calls, stats.calls],
      [TEXT.stats.things, stats.things],
    ];
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="label">${label}</span><span class="value">0</span>`;
      list.appendChild(row);
      await wait(60);
      row.classList.add('in');
      const v = row.querySelector('.value')!;
      // Count up with ticks; long counts go quicker.
      const steps = Math.min(value, 24);
      for (let i = 1; i <= steps; i++) {
        v.textContent = String(Math.round((value * i) / steps));
        cb.onTick();
        await wait(steps > 12 ? 34 : 60);
      }
      v.textContent = String(value);
      await wait(520);
    }
    // The last line always lands alone.
    await wait(700);
    const last = document.createElement('div');
    last.className = 'row last';
    last.innerHTML = `<span class="label">${TEXT.stats.pending}</span><span class="value">0</span>`;
    list.appendChild(last);
    await wait(60);
    last.classList.add('in');
    cb.onTick();
    await wait(2200);

    if (PERSONAL_MESSAGE.trim()) {
      list.classList.add('dim');
      const msg = document.createElement('div');
      msg.className = 'message';
      msg.innerText = PERSONAL_MESSAGE;
      if (PERSONAL_SIGNATURE.trim()) {
        const sig = document.createElement('div');
        sig.className = 'signature';
        sig.innerText = PERSONAL_SIGNATURE;
        msg.appendChild(sig);
      }
      r.appendChild(msg);
      await wait(60);
      msg.classList.add('in');
      await wait(3500);
    }

    const choices = document.createElement('div');
    choices.className = 'choices';
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'choice';
    again.textContent = TEXT.again;
    const sleep = document.createElement('button');
    sleep.type = 'button';
    sleep.className = 'choice primary';
    sleep.textContent = TEXT.sleep;
    choices.append(again, sleep);
    r.appendChild(choices);
    if (opts.homeHint) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = opts.homeHint;
      r.appendChild(hint);
      await wait(30);
      hint.classList.add('in');
    }
    await wait(40);
    choices.classList.add('in');
    await new Promise<void>((resolve) => {
      again.addEventListener('click', () => (cb.onAgain(), resolve()), { once: true });
      sleep.addEventListener('click', () => (cb.onSleep(), resolve()), { once: true });
    });
  }

  async goodnight(): Promise<void> {
    const r = this.root;
    r.innerHTML = '';
    r.className = 'ending on night';
    const g = document.createElement('div');
    g.className = 'goodnight';
    g.textContent = TEXT.goodnight;
    r.appendChild(g);
    await wait(80);
    g.classList.add('in');
  }

  /** Fades the whole stage to black (before "Another shift?" resets the room). */
  async blackout(ms = 900): Promise<void> {
    const b = document.createElement('div');
    b.className = 'blackout';
    this.stage.appendChild(b);
    await wait(20);
    b.classList.add('in');
    await wait(ms);
  }

  /** "You've broken N things." at the start of a later session. */
  returning(n: number): void {
    const el = document.createElement('div');
    el.className = 'returning';
    el.textContent = TEXT.returning(n);
    this.stage.appendChild(el);
    setTimeout(() => el.classList.add('in'), 800);
    setTimeout(() => el.classList.remove('in'), 5200);
    setTimeout(() => el.remove(), 7000);
  }
}
