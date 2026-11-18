import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MediaError, sanitize } from '@/lib/media';

/** A PNG whose header claims a huge picture. Decoding it for real would take gigabytes, so it must be refused from the header alone. */
function pngClaiming(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(4))), chunk('IEND', Buffer.alloc(0))]);
}

describe('hostile pictures', () => {
  // The upload form is public, so a few bytes of header must not be able to make the server allocate gigabytes.
  it('refuses a picture that claims to be 144 megapixels, quickly and politely', async () => {
    const started = Date.now();
    await expect(sanitize(pngClaiming(12_000, 12_000))).rejects.toBeInstanceOf(MediaError);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('refuses a header that claims more pixels than a PNG can even hold', async () => {
    await expect(sanitize(pngClaiming(2_147_483_647, 2_147_483_647))).rejects.toBeInstanceOf(MediaError);
  });

  it('refuses a file that is not a picture at all', async () => {
    await expect(sanitize(Buffer.from('MZ this is an executable pretending to be a photo'.repeat(40)))).rejects.toBeInstanceOf(MediaError);
  });
});
