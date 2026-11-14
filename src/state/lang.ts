/**
 * Interface language. English is the default. The choice is saved only when the user presses the language button,
 * under a new key: v2.0 saved "ar" automatically on every visit under "st-lang", which must not carry over.
 */
export type Lang = 'ar' | 'en';
export const LANG_KEY = 'st-lang-choice';

export function pickLang(stored: string | null): Lang {
  return stored === 'ar' ? 'ar' : 'en';
}

export function savedLang(): Lang {
  try {
    return pickLang(localStorage.getItem(LANG_KEY));
  } catch {
    return 'en';
  }
}

export function saveLang(lang: Lang): void {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage unavailable */ }
}
