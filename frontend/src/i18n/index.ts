/**
 * Minimal i18n layer. UI chrome strings go through `t()` so translations can be
 * added as new dictionaries; `dir` supports right-to-left locales.
 * Phase 1 ships English only; many inspector strings are still inline and are
 * tracked for extraction in docs/IMPLEMENTATION_PLAN.md.
 */
import { en } from './en';

export type MessageKey = keyof typeof en;
type Dictionary = Record<MessageKey, string>;

const dictionaries: Record<string, { messages: Dictionary; dir: 'ltr' | 'rtl' }> = {
  en: { messages: en, dir: 'ltr' },
};

let locale = 'en';

export function setLocale(next: string) {
  if (dictionaries[next]) locale = next;
  document.documentElement.lang = locale;
  document.documentElement.dir = dictionaries[locale]!.dir;
}

export function t(key: MessageKey): string {
  return dictionaries[locale]?.messages[key] ?? en[key];
}
