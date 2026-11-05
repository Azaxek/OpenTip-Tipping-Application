import { describe, expect, it } from 'vitest';
import { UnsafeUrlError, assertPublicHttpsUrl, isPrivateAddress } from '@/lib/outbound';

const publicDns = async () => [{ address: '93.184.216.34' }];

describe('isPrivateAddress', () => {
  it('refuses every private, loopback, link-local and reserved IPv4 range', () => {
    for (const ip of [
      '0.0.0.0', '10.0.0.1', '10.255.255.255', '127.0.0.1', '127.8.8.8', '169.254.169.254', '172.16.0.1', '172.31.255.255',
      '192.168.0.1', '100.64.0.1', '100.127.255.255', '192.0.0.8', '198.18.0.1', '198.19.255.255', '192.0.2.5', '198.51.100.5', '203.0.113.5',
      '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
    ]) expect(isPrivateAddress(ip), ip).toBe(true);
  });

  it('allows ordinary public IPv4 addresses, including those just outside the private ranges', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1', '11.0.0.1', '192.167.1.1', '198.17.0.1', '198.20.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('refuses private IPv6 forms, including IPv4 hidden inside IPv6', () => {
    for (const ip of ['::', '::1', '0:0:0:0:0:0:0:1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '2001:db8::1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '64:ff9b::7f00:1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows public IPv6 and public IPv4-mapped addresses, and refuses anything that is not an address', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) expect(isPrivateAddress(ip), ip).toBe(false);
    for (const junk of ['', 'not-an-ip', '999.1.1.1', '1.2.3']) expect(isPrivateAddress(junk), junk).toBe(true);
  });
});

describe('assertPublicHttpsUrl', () => {
  it('accepts a normal chat-service webhook and returns the parsed address', async () => {
    const url = await assertPublicHttpsUrl('https://hooks.slack.com/services/T000/B000/XXXX', publicDns);
    expect(url.hostname).toBe('hooks.slack.com');
    await expect(assertPublicHttpsUrl('https://discord.com:443/api/webhooks/1/abc', publicDns)).resolves.toBeInstanceOf(URL);
  });

  it('refuses anything that is not https, has credentials, or uses a non-standard port', async () => {
    await expect(assertPublicHttpsUrl('http://hooks.slack.com/x', publicDns)).rejects.toThrow('https');
    await expect(assertPublicHttpsUrl('ftp://hooks.slack.com/x', publicDns)).rejects.toThrow('https');
    await expect(assertPublicHttpsUrl('https://user:pw@hooks.slack.com/x', publicDns)).rejects.toThrow('username');
    await expect(assertPublicHttpsUrl('https://hooks.slack.com:8443/x', publicDns)).rejects.toThrow('port');
    await expect(assertPublicHttpsUrl('not a url', publicDns)).rejects.toThrow('valid web address');
  });

  it('refuses internal names and IP literals without needing DNS at all', async () => {
    const neverCalled = async () => { throw new Error('DNS should not be consulted'); };
    for (const u of [
      'https://localhost/x', 'https://intranet/x', 'https://printer.local/x', 'https://db.internal/x', 'https://a.localhost/x',
      'https://127.0.0.1/x', 'https://[::1]/x', 'https://169.254.169.254/latest/meta-data', 'https://10.1.2.3/x', 'https://[::ffff:10.0.0.1]/x', 'https://[fd00::1]/x',
    ]) await expect(assertPublicHttpsUrl(u, neverCalled), u).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses a public-looking name that resolves to a private address, even if only one of several records is private', async () => {
    await expect(assertPublicHttpsUrl('https://evil.example.com/x', async () => [{ address: '10.0.0.5' }])).rejects.toThrow('private network');
    await expect(assertPublicHttpsUrl('https://evil.example.com/x', async () => [{ address: '93.184.216.34' }, { address: '169.254.169.254' }])).rejects.toThrow('private network');
    await expect(assertPublicHttpsUrl('https://evil.example.com/x', async () => [{ address: '::ffff:127.0.0.1' }])).rejects.toThrow('private network');
  });

  it('gives a clear message when the name does not resolve or resolves to nothing', async () => {
    await expect(assertPublicHttpsUrl('https://nope.example.com/x', async () => { throw new Error('ENOTFOUND'); })).rejects.toThrow('could not be found');
    await expect(assertPublicHttpsUrl('https://empty.example.com/x', async () => [])).rejects.toThrow('private network');
  });
});

describe('the alert webhook sender', () => {
  it('never calls an internal address, and still delivers to a public one', async () => {
    const { vi } = await import('vitest');
    const { sendWebhook } = await import('@/lib/escalation');
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      for (const bad of ['https://127.0.0.1/hook', 'https://169.254.169.254/latest/meta-data', 'http://hooks.slack.com/x', 'https://localhost/x']) {
        expect(await sendWebhook(bad, 'alert'), bad).toBe('failed');
      }
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await sendWebhook('https://hooks.slack.com/services/T/B/X', 'alert')).toBe('sent'); // DNS is mocked to a public address in tests/setup.ts
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // Only the first address is checked, so a redirect to an internal one must fail instead of being followed.
      expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: 'error' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
