/**
 * Makes the page behave like a native app on phones.
 * - Blocks browser gestures: pinch and double-tap zoom, long-press menus, pull-to-refresh,
 *   rubber-band scrolling.
 * - Android: true full screen (no browser bars) and portrait lock on the first touch.
 *   iPhone Safari doesn't allow either for web pages; it gets the same result when the game is
 *   added to the home screen (offered after the first ending).
 * - Keeps the screen awake while playing (Screen Wake Lock), re-acquired when returning.
 */

export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isTouch = matchMedia('(pointer: coarse)').matches;
export const isStandalone =
  matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function installMobileBehaviour(stage: HTMLElement): void {
  const block = (e: Event) => e.preventDefault();
  document.addEventListener('contextmenu', block);
  document.addEventListener('gesturestart', block as EventListener); // iOS pinch
  document.addEventListener('dblclick', block);
  document.addEventListener('touchmove', block, { passive: false });
  document.addEventListener('selectstart', block);

  // Chrome only grants fullscreen and history entries from a gesture that ends (pointerup), not
  // from pointerdown on touch.
  let firstTouch = true;
  let guarded = false;
  stage.addEventListener(
    'pointerup',
    () => {
      if (firstTouch) {
        firstTouch = false;
        void keepAwake();
      }
      // Back-swipe guard: one extra history entry, so Android's back gesture (easy to trigger
      // mid-swing from the screen edge) lands here instead of leaving the game.
      if (!guarded) {
        guarded = true;
        history.pushState({ nightDuty: true }, '');
      }
      // The back gesture also drops fullscreen; the next touch brings it back.
      if (isTouch && !isIOS && !isStandalone && !document.fullscreenElement) void enterFullscreen();
    },
    { capture: true },
  );
  window.addEventListener('popstate', () => {
    guarded = false; // re-armed on the next touch
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !firstTouch) void keepAwake();
  });
}

async function enterFullscreen(): Promise<void> {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
    }
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.('portrait').catch(() => {});
  } catch {
    /* not allowed here; the game works the same without it */
  }
}

let wakeLock: { release(): Promise<void> } | null = null;
async function keepAwake(): Promise<void> {
  try {
    const nav = navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (nav.wakeLock && !wakeLock) {
      wakeLock = await nav.wakeLock.request('screen');
      (wakeLock as unknown as EventTarget).addEventListener?.('release', () => (wakeLock = null));
    }
  } catch {
    wakeLock = null;
  }
}
