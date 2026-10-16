import sharp from 'sharp';
import { audit } from './audit';
import { withOrg } from './db';
import { StaffInputError, isUuid } from './queue';
import type { Staff } from './staff';

export type PublicBulletin = { id: string; title: string; body: string; case_number: string | null; reward_cents: number | null; has_image: boolean; created_at: Date };

const PUBLIC_COLS = 'id, title, body, case_number, reward_cents, (image is not null) as has_image, created_at';

/** What anyone may see: active bulletins only, newest first. */
export const listPublicBulletins = (orgId: string) =>
  withOrg(orgId, (q) => q<PublicBulletin>(`select ${PUBLIC_COLS} from bulletins where active order by created_at desc limit 100`));

export const getPublicBulletin = (orgId: string, id: string) =>
  isUuid(id) ? withOrg(orgId, async (q) => (await q<PublicBulletin>(`select ${PUBLIC_COLS} from bulletins where id = $1 and active`, [id]))[0] ?? null) : Promise.resolve(null);

export const bulletinImage = (orgId: string, id: string) =>
  isUuid(id) ? withOrg(orgId, async (q) => (await q<{ image: Buffer }>('select image from bulletins where id = $1 and active and image is not null', [id]))[0]?.image ?? null) : Promise.resolve(null);

/** Photo -> upright JPEG no larger than 1200 px, with every piece of metadata (EXIF, GPS, camera, ICC) removed. */
export async function cleanBulletinPhoto(input: Buffer): Promise<Buffer> {
  try {
    return await sharp(input, { failOn: 'error' }).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } catch {
    throw new StaffInputError('That file could not be read as a picture. Use a JPEG, PNG or WebP photo.');
  }
}

export type BulletinInput = { id?: string; title: string; body: string; caseNumber: string; rewardDollars: string; active: boolean; photo?: Buffer | null; removePhoto?: boolean };

export const listAllBulletins = (s: Staff) =>
  withOrg(s.orgId, (q) =>
    q<PublicBulletin & { active: boolean; tips: number }>(
      `select ${PUBLIC_COLS}, active, (select count(*)::int from tips t where t.bulletin_id = bulletins.id) as tips from bulletins order by active desc, created_at desc`,
    ),
  );

export const saveBulletin = (s: Staff, i: BulletinInput) =>
  withOrg(s.orgId, async (q) => {
    if (s.role !== 'admin') throw new StaffInputError('Admins only');
    const title = i.title.trim();
    if (!title) throw new StaffInputError('A bulletin needs a headline.');
    const maxReward = (await q<{ max_reward_cents: number }>('select max_reward_cents from organizations'))[0].max_reward_cents;
    const reward = i.rewardDollars.trim() === '' ? null : Math.round(Number(i.rewardDollars) * 100);
    if (reward !== null && (!Number.isFinite(reward) || reward < 0 || reward > maxReward)) {
      throw new StaffInputError(`The reward must be between $0 and your program maximum of $${(maxReward / 100).toFixed(2)} (change that in Settings).`);
    }
    const photo = i.photo?.length ? await cleanBulletinPhoto(i.photo) : null;
    const vals = [title, i.body.trim().slice(0, 3000), i.caseNumber.trim().slice(0, 60) || null, reward, i.active];
    let id = i.id;
    if (id) {
      if (!isUuid(id)) throw new StaffInputError('Unknown bulletin');
      const r = await q('update bulletins set title=$1, body=$2, case_number=$3, reward_cents=$4, active=$5 where id=$6 returning id', [...vals, id]);
      if (!r.length) throw new StaffInputError('Unknown bulletin');
    } else {
      id = (await q<{ id: string }>('insert into bulletins (title, body, case_number, reward_cents, active, org_id) values ($1,$2,$3,$4,$5,$6) returning id', [...vals, s.orgId]))[0].id;
    }
    if (photo) await q('update bulletins set image = $2 where id = $1', [id, photo]);
    else if (i.removePhoto) await q('update bulletins set image = null where id = $1', [id]);
    await audit(q, s, i.id ? 'bulletin.update' : 'bulletin.create', null, { title });
    return id!;
  });

export const deleteBulletin = (s: Staff, id: string) =>
  withOrg(s.orgId, async (q) => {
    if (s.role !== 'admin') throw new StaffInputError('Admins only');
    if (!isUuid(id)) throw new StaffInputError('Unknown bulletin');
    await q('delete from bulletins where id = $1', [id]);
    await audit(q, s, 'bulletin.delete');
  });
