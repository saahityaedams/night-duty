/**
 * Every word shown outside the 3D scene, from the design doc's "On-screen text" section.
 * Voice: dry hospital admin. No exclamation marks, no encouragement, no wellness language.
 */

export const TEXT = {
  stats: {
    cups: 'Cups broken',
    pages: 'Pages shredded',
    popups: 'Pop-ups closed',
    calls: 'Calls declined',
    things: 'Things broken',
    pending: 'Pending',
  },
  again: 'Another shift?',
  sleep: 'Go to sleep',
  goodnight: 'Goodnight.',
  homeScreenIOS: 'Keep it on your home screen: tap Share, then Add to Home Screen.',
  homeScreenAndroid: 'Keep it on your home screen: open the browser menu, then Add to Home screen.',
  returning: (n: number) => `You've broken ${n.toLocaleString('en-IN')} things.`,
};

/**
 * The personal message that fades in after the stats. Empty for now: the owner writes it.
 * Line breaks are kept. Leave empty to skip the message entirely.
 */
export const PERSONAL_MESSAGE = '';
export const PERSONAL_SIGNATURE = '';
