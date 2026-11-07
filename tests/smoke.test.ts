import { describe, it, expect } from 'vitest';
import { system, withOrg } from '@/lib/db';

describe('db smoke', () => {
  it('migrated and RLS isolates tenants', async () => {
    const [a, b] = await system(async (q) => [
      (await q<{ id: string }>('insert into organizations (slug,name,org_type) values ($1,$2,$3) returning id', ['a', 'A', 'campus']))[0].id,
      (await q<{ id: string }>('insert into organizations (slug,name,org_type) values ($1,$2,$3) returning id', ['b', 'B', 'campus']))[0].id,
    ]);
    await withOrg(a, (q) => q('insert into teams (org_id,name) values ($1,$2)', [a, 'T']));
    expect(await withOrg(a, (q) => q('select 1 from teams'))).toHaveLength(1);
    expect(await withOrg(b, (q) => q('select 1 from teams'))).toHaveLength(0);
  });
});
