import { TAXONOMIES, type OrgType } from '../taxonomy';
import { en, type MessageKey } from './en';
import { es } from './es';
import { ES_CATEGORIES, ES_HELP, ES_NOTE } from './es-defaults';

export const LANGS = ['en', 'es'] as const;
export type Lang = (typeof LANGS)[number];
export const isLang = (s: unknown): s is Lang => typeof s === 'string' && (LANGS as readonly string[]).includes(s);
export type Messages = Record<MessageKey, string>;

const TABLE: Record<Lang, Messages> = { en, es };
export const getMessages = (lang: Lang): Messages => TABLE[lang];

/** Fills `{name}` placeholders. Unknown placeholders are left visible so a missing value is noticed, not silently blank. */
export const fmt = (s: string, vars: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

/** `/submit` for English, `/es/submit` for Spanish. The language lives in the address, so no cookie or stored setting is needed. */
export const localHref = (lang: Lang, path: string) => (lang === 'en' ? path : `/${lang}${path === '/' ? '' : path}`);

type Cat = { name: string; description: string };

/** Spanish name and description for the built-in categories, as long as the organization has not reworded them. */
export function localizeCategory<T extends Cat>(c: T, lang: Lang, type: OrgType): T {
  if (lang !== 'es') return c;
  const idx = TAXONOMIES[type].categories.findIndex((d) => d.name === c.name && d.description === c.description);
  const t = idx >= 0 ? ES_CATEGORIES[type][idx] : undefined;
  return t ? { ...c, name: t[0], description: t[1] } : c;
}

/**
 * The "what to expect" and "help resources" text in the visitor's language: the organization's own Spanish version if it wrote
 * one, the built-in Spanish default while the English text is still the built-in default, otherwise the English text.
 */
export function localizeOrgText(kind: 'note' | 'help', english: string, spanish: string | null | undefined, lang: Lang, type: OrgType): string {
  if (lang !== 'es') return english;
  if (spanish?.trim()) return spanish;
  const defaults = kind === 'note' ? TAXONOMIES[type].tipsterNote : TAXONOMIES[type].helpText;
  return english.trim() === defaults.trim() ? (kind === 'note' ? ES_NOTE : ES_HELP)[type] : english;
}
