import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tourSteps } from '@/lib/tour';

const read = (p: string) => readFileSync(p, 'utf8');
const anchors = read('src/app/staff/(console)/page.tsx') + read('src/app/staff/(console)/layout.tsx');

describe('console tour', () => {
  it('shows reviewers the steps that are theirs and administrators the settings steps too', () => {
    const reviewer = tourSteps('reviewer').map((s) => s.target);
    const admin = tourSteps('admin').map((s) => s.target);
    expect(reviewer).not.toContain('nav-settings');
    expect(reviewer).not.toContain('nav-materials');
    expect(admin).toEqual(expect.arrayContaining(['nav-settings', 'nav-materials']));
    expect(admin.length).toBeGreaterThan(reviewer.length);
  });

  // A refactor that renames or drops an anchor would silently shorten the tour (steps without an anchor are skipped), so fail instead.
  it('has a real anchor in the page for every step', () => {
    for (const { target } of tourSteps('admin')) {
      if (!target) continue; // the welcome card has no anchor
      if (target.startsWith('nav-')) expect(anchors, target).toContain(`'/staff/${target.slice(4)}'`);
      else expect(anchors, target).toContain(`data-tour="${target}"`);
    }
  });

  it('stays a tour: short steps, unique titles, one welcome card first', () => {
    const steps = tourSteps('admin');
    expect(steps[0]?.target).toBeNull();
    expect(new Set(steps.map((s) => s.title)).size).toBe(steps.length);
    for (const s of steps) expect(s.body.length, s.title).toBeLessThanOrEqual(240);
  });
});
