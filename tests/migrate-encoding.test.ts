import { describe, expect, it } from 'vitest';
import { assertUtf8 } from '../scripts/migrate.mjs';

const serverWith = (server_encoding: string) => ({ query: async () => ({ rows: [{ server_encoding }] }) });

describe('database encoding check', () => {
  it('accepts a UTF8 database', async () => {
    await expect(assertUtf8(serverWith('UTF8'))).resolves.toBeUndefined();
  });

  // A default Windows install creates WIN1252 databases: a tip in Arabic or with an emoji then fails with a 500 and is lost.
  it.each(['WIN1252', 'LATIN1', 'SQL_ASCII'])('refuses %s and says how to fix it', async (enc) => {
    await expect(assertUtf8(serverWith(enc))).rejects.toThrow(new RegExp(`${enc}.*CREATE DATABASE opentip ENCODING 'UTF8'`));
  });

  it('really is UTF8 where the test suite runs', async () => {
    const { system } = await import('@/lib/db');
    const [{ server_encoding }] = await system((q) => q<{ server_encoding: string }>('show server_encoding'));
    expect(server_encoding).toBe('UTF8');
  });
});
