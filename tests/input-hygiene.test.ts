import { describe, expect, it } from 'vitest';
import { publicPost } from '@/lib/http';
import { withoutNul } from '@/lib/text';

const post = (body: unknown) => new Request('http://localhost/api/x', { method: 'POST', body: JSON.stringify(body) });

describe('text that Postgres cannot store', () => {
  it('removes NUL characters and nothing else', () => {
    expect(withoutNul('a\u0000b\u0000')).toBe('ab');
    expect(withoutNul('é 👋 مرحبا "q" <b>')).toBe('é 👋 مرحبا "q" <b>');
  });

  // Found by hand: a description containing \u0000 made the tip form answer "Something went wrong" and the tip was lost.
  it('cleans every string in a public request, including nested ones', async () => {
    const r = await publicPost(post({ description: 'x\u0000y', nested: { list: ['a\u0000'] }, n: 1 }), 'hygiene', 100, 60_000);
    expect('body' in r && r.body).toEqual({ description: 'xy', nested: { list: ['a'] }, n: 1 });
  });
});
