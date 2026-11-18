/**
 * Minimal on-screen controls: a tool strip at the bottom (hand, bat, sledgehammer) and edge arrows
 * to look left and right. Icons only, no words. Tools and directions can be hidden until the arc
 * unlocks them.
 */

import type { ToolName } from '../game/tools';

const ICONS: Record<ToolName, string> = {
  hand: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11.5V4a1.5 1.5 0 0 1 3 0v7.5"/><path d="M14 11.5V5.5a1.5 1.5 0 0 1 3 0V14"/><path d="M8 12.5l-1.2-1.6a1.6 1.6 0 0 0-2.6 1.9l2.6 4.1A6 6 0 0 0 12 20h1a5 5 0 0 0 5-5v-2"/></svg>`,
  bat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M5.1 18.1L16.6 4.6a2 2 0 0 1 2.8 2.8L5.9 18.9z"/><circle cx="4.5" cy="19.5" r="1.2"/></svg>`,
  hammer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 10.5L5 19a1.4 1.4 0 0 1-2-2l8.5-8.5"/><path d="M11.5 6.5l4-4 6 6-4 4z"/></svg>`,
};

const CHEVRON = (dir: 'left' | 'right') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}"/></svg>`;

export interface Hud {
  setTool(t: ToolName): void;
  setTools(available: ToolName[]): void;
  setArrows(left: boolean, right: boolean): void;
  onTool(cb: (t: ToolName) => void): void;
  onLook(cb: (dir: 'left' | 'right') => void): void;
  /** Hide everything (finale, dawn). */
  setVisible(v: boolean): void;
}

export function createHud(stage: HTMLElement): Hud {
  const root = document.createElement('div');
  root.className = 'hud';
  const strip = document.createElement('div');
  strip.className = 'tool-strip';
  const buttons = new Map<ToolName, HTMLButtonElement>();
  const toolCbs: ((t: ToolName) => void)[] = [];
  const lookCbs: ((d: 'left' | 'right') => void)[] = [];
  (['hand', 'bat', 'hammer'] as ToolName[]).forEach((t) => {
    const b = document.createElement('button');
    b.className = 'tool';
    b.type = 'button';
    b.setAttribute('aria-label', t);
    b.innerHTML = ICONS[t];
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      toolCbs.forEach((cb) => cb(t));
    });
    strip.appendChild(b);
    buttons.set(t, b);
  });
  const arrows = new Map<'left' | 'right', HTMLButtonElement>();
  (['left', 'right'] as const).forEach((d) => {
    const b = document.createElement('button');
    b.className = `look look-${d}`;
    b.type = 'button';
    b.setAttribute('aria-label', `look ${d}`);
    b.innerHTML = CHEVRON(d);
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      lookCbs.forEach((cb) => cb(d));
    });
    root.appendChild(b);
    arrows.set(d, b);
  });
  root.appendChild(strip);
  stage.appendChild(root);

  return {
    setTool(t) {
      buttons.forEach((b, k) => b.classList.toggle('active', k === t));
    },
    setTools(available) {
      buttons.forEach((b, k) => b.classList.toggle('hidden', !available.includes(k)));
      strip.classList.toggle('hidden', available.length < 2);
    },
    setArrows(left, right) {
      arrows.get('left')!.classList.toggle('hidden', !left);
      arrows.get('right')!.classList.toggle('hidden', !right);
    },
    onTool: (cb) => toolCbs.push(cb),
    onLook: (cb) => lookCbs.push(cb),
    setVisible(v) {
      root.classList.toggle('gone', !v);
    },
  };
}
