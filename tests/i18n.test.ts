import { describe, expect, it } from 'vitest';
import { checkEvidence } from '@/lib/evidence-check';
import { LANGS, fmt, getMessages, isLang, localHref, localizeCategory, localizeOrgText } from '@/lib/i18n';
import { en } from '@/lib/i18n/en';
import { ES_CATEGORIES, ES_HELP, ES_NOTE } from '@/lib/i18n/es-defaults';
import { TAXONOMIES } from '@/lib/taxonomy';
import { createTip, getTipStatus } from '@/lib/tipster';
import { system } from '@/lib/db';
import { categoryId, makeOrg } from './helpers';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations are complete and consistent', () => {
  for (const lang of LANGS.filter((l) => l !== 'en')) {
    const m = getMessages(lang) as Record<string, string>;

    it(`${lang}: has exactly the same keys as English, none empty`, () => {
      expect(Object.keys(m).sort()).toEqual(Object.keys(en).sort());
      for (const [k, v] of Object.entries(m)) expect(v.trim(), `${lang}.${k}`).not.toBe('');
    });

    it(`${lang}: uses the same {placeholders} as English in every message (a missing one would show a blank or a raw {name})`, () => {
      for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(m[k]), `${lang}.${k}`).toEqual(placeholders(en[k]));
    });

    it(`${lang}: the safety notice keeps its essential content`, () => {
      expect(m.emergency).toMatch(/911/);
      expect(m.emergency.length).toBeGreaterThan(40);
    });

    it(`${lang}: does not leave obvious English in places a visitor will read`, () => {
      // A cheap guard against pasting English into the wrong catalogue: these are the most visible strings.
      for (const k of ['homeSubmit', 'homeCheck', 'next', 'back', 'submit', 'checkTitle', 'receiptTitle'] as const) expect(m[k], k).not.toBe(en[k]);
    });
  }

  it('every built-in category has a Spanish name and description, in the same order as the English defaults', () => {
    for (const type of ['campus', 'crime_stoppers'] as const) {
      expect(ES_CATEGORIES[type]).toHaveLength(TAXONOMIES[type].categories.length);
      for (const [name, description] of ES_CATEGORIES[type]) { expect(name.length).toBeGreaterThan(1); expect(description.length).toBeGreaterThan(10); }
    }
  });
});

describe('language helpers', () => {
  it('fmt fills placeholders and leaves unknown ones visible', () => {
    expect(fmt('Step {i} of {n}', { i: 2, n: 4 })).toBe('Step 2 of 4');
    expect(fmt('Hello {who}', {})).toBe('Hello {who}');
    expect(fmt('$1 {a} {a}', { a: '$&' })).toBe('$1 $& $&'); // replacement characters in values are literal
  });

  it('recognises supported languages only', () => {
    expect(isLang('es')).toBe(true);
    expect(isLang('fr')).toBe(false);
    expect(isLang('../etc')).toBe(false);
    expect(isLang(undefined)).toBe(false);
  });

  it('keeps the language in the address, with English at the plain paths', () => {
    expect(localHref('en', '/')).toBe('/');
    expect(localHref('en', '/submit')).toBe('/submit');
    expect(localHref('es', '/')).toBe('/es');
    expect(localHref('es', '/submit')).toBe('/es/submit');
  });

  it('translates built-in categories, but never text the organization has reworded', () => {
    const d = TAXONOMIES.campus.categories[0];
    expect(localizeCategory({ id: 1, ...d }, 'es', 'campus').name).toBe(ES_CATEGORIES.campus[0][0]);
    expect(localizeCategory({ id: 1, ...d }, 'en', 'campus').name).toBe(d.name);
    const edited = { id: 2, name: d.name, description: 'Our own wording about it.' };
    expect(localizeCategory(edited, 'es', 'campus')).toEqual(edited);
    const custom = { id: 3, name: 'Parking lot incidents', description: 'x' };
    expect(localizeCategory(custom, 'es', 'campus')).toEqual(custom);
    // "Weapons" exists in both programs with different descriptions: each maps to its own translation.
    const cs = TAXONOMIES.crime_stoppers.categories.find((c) => c.name === 'Weapons')!;
    const ca = TAXONOMIES.campus.categories.find((c) => c.name === 'Weapons')!;
    expect(localizeCategory({ ...cs }, 'es', 'crime_stoppers').description).not.toBe(localizeCategory({ ...ca }, 'es', 'campus').description);
  });

  it('shows the organization\'s own Spanish text first, the built-in Spanish while the English is still the default, otherwise the English', () => {
    const t = TAXONOMIES.campus;
    expect(localizeOrgText('help', t.helpText, '', 'en', 'campus')).toBe(t.helpText);
    expect(localizeOrgText('help', t.helpText, '', 'es', 'campus')).toBe(ES_HELP.campus);
    expect(localizeOrgText('note', t.tipsterNote, '  ', 'es', 'campus')).toBe(ES_NOTE.campus);
    expect(localizeOrgText('help', 'Call our counselor at 555-0100.', '', 'es', 'campus')).toBe('Call our counselor at 555-0100.'); // never replace what they wrote with a default
    expect(localizeOrgText('help', t.helpText, 'Llame a nuestra consejera.', 'es', 'campus')).toBe('Llame a nuestra consejera.');
  });

  it('crisis resources in Spanish name the Spanish-language options (988 press 2, text AYUDA)', () => {
    expect(ES_HELP.campus).toMatch(/988/);
    expect(ES_HELP.campus).toMatch(/oprime 2/);
    expect(ES_HELP.campus).toMatch(/AYUDA/);
    expect(ES_HELP.campus).toMatch(/741741/);
  });
});

describe('evidence messages follow the visitor\'s language', () => {
  const limits = { imageMb: 10, docMb: 10, avMb: 25, tipMb: 50, maxFiles: 3 };
  it('returns Spanish text with the name and numbers filled in', () => {
    const es = getMessages('es');
    expect(checkEvidence({ name: 'notas.txt', type: 'text/plain', size: 5 }, [], limits, es)).toContain('"notas.txt"');
    expect(checkEvidence({ name: 'a.jpg', type: 'image/jpeg', size: 11 * 1048576 }, [], limits, es)).toMatch(/límite de 10 MB para fotos/);
    expect(checkEvidence({ name: 'IMG.HEIC', type: 'image/heic', size: 5 }, [], limits, es)).toMatch(/JPEG/);
    expect(checkEvidence({ name: 'a.jpg', type: 'image/jpeg', size: 1 }, [{ size: 1 }, { size: 1 }, { size: 1 }], limits, es)).toMatch(/hasta 3 archivos/);
  });
});

describe('the tipster\'s status page in Spanish', () => {
  it('translates the category and the built-in guidance, but only until the organization writes its own', async () => {
    const { org } = await makeOrg('campus');
    await createTip(org, { categoryId: await categoryId(org, 'Theft'), description: 'x', passcode: 'hunter22' });
    const tip = (await system((q) => q<any>('select id from tips where org_id = $1', [org.id])))[0].id;
    const es = (await getTipStatus(org.id, tip, 'es'))!;
    expect(es.category).toBe('Robo');
    expect(es.note).toBe(ES_NOTE.campus);
    expect(es.resources).toBe(ES_HELP.campus);
    const en_ = (await getTipStatus(org.id, tip))!;
    expect(en_.category).toBe('Theft');
    expect(en_.resources).toBe(TAXONOMIES.campus.helpText);
    await system((q) => q("update organizations set help_text = 'Our counselor: 555-0100' where id = $1", [org.id]));
    expect((await getTipStatus(org.id, tip, 'es'))!.resources).toBe('Our counselor: 555-0100');
    await system((q) => q("update organizations set help_text_es = 'Nuestra consejera: 555-0100' where id = $1", [org.id]));
    expect((await getTipStatus(org.id, tip, 'es'))!.resources).toBe('Nuestra consejera: 555-0100');
  });
});
