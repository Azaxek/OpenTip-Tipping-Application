import { describe, expect, it } from 'vitest';
import { announcements, submitUrl } from '@/lib/materials';
import { makeOrg } from './helpers';

describe('announcement texts', () => {
  for (const type of ['campus', 'crime_stoppers'] as const) {
    it(`are complete and honest for a ${type} program`, async () => {
      const { org } = await makeOrg(type);
      const kit = announcements(org);
      expect(kit.map((a) => a.id)).toEqual(['press', 'announcement', 'social', 'team']);
      for (const a of kit) {
        expect(a.text, a.id).toContain(org.name);
        expect(a.text, a.id).not.toMatch(/undefined|null|\{|\}/);
      }
      for (const a of kit.filter((x) => x.id !== 'team')) {
        expect(a.text, a.id).toContain(submitUrl());
        expect(a.text, a.id).toContain('911'); // every public text says what the line is not
      }
      expect(kit.find((a) => a.id === 'social')?.text.length).toBeLessThanOrEqual(280);
      expect(kit.find((a) => a.id === 'team')?.text).toContain(`${org.response_target_hours} hours`);
      // never promises what the app does not do
      expect(kit.map((a) => a.text).join('\n')).not.toMatch(/monitored 24|24\/7|guarantee/i);
    });
  }
});
