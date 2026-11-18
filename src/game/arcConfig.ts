/**
 * Pacing for the session arc. Progress is driven by what she breaks, never by time.
 * Every number that shapes the feel of a session lives here.
 */
export const ARC = {
  /** Progress points per event. */
  points: {
    mug: 1, // mugs, the pen jar
    small: 1, // stapler, bottle, clock, paperwork, keyboard, phone
    big: 3, // printer, tower, locker, whiteboard
    hit: 0.15, // any damaging hit that doesn't break
    crumple: 0.4, // a paper cup crumpling
  },
  /** Progress needed for each unlock. */
  unlockBat: 6,
  revealRight: 13,
  unlockHammer: 21,
  /** Progress at which the meter is full and the finale begins. */
  finale: 40,
  /** Seconds of camera travel for reveals. */
  revealSeconds: 2.2,
  /** Seconds of silence after the last swing before the screen flickers. */
  silence: 1.6,
  /** Seconds for night to become dawn. */
  dawnSeconds: 9,
};
