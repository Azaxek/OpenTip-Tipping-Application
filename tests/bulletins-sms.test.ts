import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as sms } from '@/app/api/sms/route';
import { bulletinImage, cleanBulletinPhoto, deleteBulletin, getPublicBulletin, listAllBulletins, listPublicBulletins, saveBulletin } from '@/lib/bulletins';
import { system } from '@/lib/db';
import { StaffInputError, getTipDetail, listQueue } from '@/lib/queue';
import { createTip } from '@/lib/tipster';
import { categoryId, makeOrg, makeReviewer } from './helpers';

afterEach(() => vi.unstubAllEnvs());

const base = { title: 'Armed robbery suspect', body: 'Seen near the market.', caseNumber: '24-1187', rewardDollars: '500', active: true };
/** A 3000x2000 JPEG that carries a copyright tag and GPS, like a phone photo would. */
const phonePhoto = () =>
  sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#336699' } })
    .withExif({ IFD0: { Copyright: 'SECRET-OWNER', Artist: 'SECRET-PHOTOGRAPHER' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 30/1 0/1' } })
    .jpeg().toBuffer();

describe('case bulletins', () => {
  it('re-encodes the photo: smaller, upright JPEG, and every trace of metadata gone', async () => {
    const original = await phonePhoto();
    expect((await sharp(original).metadata()).exif).toBeTruthy(); // the fixture really does carry metadata
    const clean = await cleanBulletinPhoto(original);
    const meta = await sharp(clean).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(1200);
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(clean.toString('latin1')).not.toMatch(/SECRET-OWNER|SECRET-PHOTOGRAPHER|GPS/);
    await expect(cleanBulletinPhoto(Buffer.from('definitely not a picture'))).rejects.toBeInstanceOf(StaffInputError);
  });

  it('admins publish, edit and delete; reviewers cannot; the reward cannot exceed the program maximum', async () => {
    const { org, admin } = await makeOrg('crime_stoppers'); // max reward $500
    const rev = await makeReviewer(org, ['Tip Coordinators']);
    await expect(saveBulletin(rev, base)).rejects.toThrow('Admins only');
    await expect(saveBulletin(admin, { ...base, title: '  ' })).rejects.toThrow('headline');
    await expect(saveBulletin(admin, { ...base, rewardDollars: '501' })).rejects.toThrow(/maximum of \$500\.00/);
    await expect(saveBulletin(admin, { ...base, rewardDollars: '-5' })).rejects.toThrow(/between/);
    await expect(saveBulletin(admin, { ...base, rewardDollars: 'abc' })).rejects.toThrow(/between/);
    const id = await saveBulletin(admin, { ...base, photo: await phonePhoto() });
    expect((await listAllBulletins(admin))[0]).toMatchObject({ title: base.title, case_number: '24-1187', reward_cents: 50000, has_image: true, active: true });
    await saveBulletin(admin, { ...base, id, title: 'Updated headline', rewardDollars: '', caseNumber: '' });
    expect((await listAllBulletins(admin))[0]).toMatchObject({ title: 'Updated headline', reward_cents: null, case_number: null, has_image: true }); // photo kept when none is sent
    await saveBulletin(admin, { ...base, id, removePhoto: true });
    expect((await listAllBulletins(admin))[0].has_image).toBe(false);
    await expect(deleteBulletin(rev, id)).rejects.toThrow('Admins only');
    await deleteBulletin(admin, id);
    expect(await listAllBulletins(admin)).toHaveLength(0);
    const log = await system((q) => q<any>("select action from audit_log where org_id = $1 and action like 'bulletin.%' order by id", [org.id]));
    expect(log.map((l: any) => l.action)).toEqual(['bulletin.create', 'bulletin.update', 'bulletin.update', 'bulletin.delete']);
  });

  it('shows the public only active bulletins and their photos, and keeps each organization to its own', async () => {
    const a = await makeOrg('crime_stoppers');
    const b = await makeOrg('crime_stoppers');
    const open = await saveBulletin(a.admin, { ...base, photo: await phonePhoto() });
    const hidden = await saveBulletin(a.admin, { ...base, title: 'Hidden', active: false, photo: await phonePhoto() });
    expect((await listPublicBulletins(a.org.id)).map((x) => x.id)).toEqual([open]);
    expect(await getPublicBulletin(a.org.id, hidden)).toBeNull();
    expect(await bulletinImage(a.org.id, open)).toBeInstanceOf(Uint8Array); // Buffer in production, Uint8Array in the in-memory test database
    expect(await bulletinImage(a.org.id, hidden)).toBeNull();
    expect(await bulletinImage(a.org.id, 'not-a-uuid')).toBeNull();
    expect(await listPublicBulletins(b.org.id)).toEqual([]); // other tenant: row-level security
    expect(await bulletinImage(b.org.id, open)).toBeNull();
    const row = (await system((q) => q<any>('select octet_length(image) as n from bulletins where id = $1', [open])))[0];
    expect(row.n).toBeLessThan(1_500_000);
  });

  it('links a tip to the case the tipster chose, and ignores a case that was closed or never existed', async () => {
    const { org, admin } = await makeOrg('crime_stoppers');
    const open = await saveBulletin(admin, base);
    const closed = await saveBulletin(admin, { ...base, title: 'Old case', active: false });
    const cat = await categoryId(org, 'Robbery');
    await createTip(org, { categoryId: cat, description: 'I saw him', passcode: 'hunter22', bulletinId: open });
    await createTip(org, { categoryId: cat, description: 'about the old one', passcode: 'hunter22', bulletinId: closed });
    await createTip(org, { categoryId: cat, description: 'made up', passcode: 'hunter22', bulletinId: '00000000-0000-4000-8000-000000000000' });
    const linked = await system((q) => q<any>('select description, bulletin_id from tips where org_id = $1 order by created_at', [org.id]));
    expect(linked.map((t: any) => t.bulletin_id)).toEqual([open, null, null]);
    const [t] = (await listQueue(admin, { search: 'I saw him' }));
    const d = await getTipDetail(admin, t.id);
    expect(d?.tip).toMatchObject({ bulletin_title: base.title, bulletin_case: '24-1187' });
    await deleteBulletin(admin, open);
    expect((await system((q) => q<any>("select bulletin_id from tips where description = 'I saw him'")))[0].bulletin_id).toBeNull(); // the tip survives its bulletin
  });
});

describe('text-to-tip reply', () => {
  it('answers with the form link as TwiML, escapes the organization name, and never echoes the text or the sender', async () => {
    const { org } = await makeOrg('crime_stoppers', { name: 'Crime <Stoppers> & "Friends"' } as any);
    vi.stubEnv('DEFAULT_ORG_SLUG', org.slug);
    vi.stubEnv('APP_URL', 'https://tips.example.org');
    const res = await sms(new Request('http://x/api/sms', { method: 'POST', body: 'From=%2B15551234567&Body=he%20has%20a%20gun', headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/xml/);
    const xml = await res.text();
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?><Response><Message>.*<\/Message><\/Response>$/);
    expect(xml).toContain('https://tips.example.org/submit');
    expect(xml).toContain('Crime &#60;Stoppers&#62; &#38; &#34;Friends&#34;');
    expect(xml).not.toMatch(/5551234567|gun/);
    expect(xml).toContain('911');
    expect((xml.match(/<Message>/g) ?? []).length).toBe(1);
  });
});
