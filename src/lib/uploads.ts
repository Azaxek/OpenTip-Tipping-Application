import { randomUUID } from 'node:crypto';
import { withOrg } from './db';
import { ACCEPT, MediaError, capBytes, kindOfClaimedMime, sanitize } from './media';
import type { Org } from './org';
import { getStorage } from './storage';

const QUARANTINE_KEY = /^quarantine\/[0-9a-f-]{36}$/;

/** Validates what the tipster says they will upload against the org's limits and hands back presigned PUT URLs. */
export async function planUploads(org: Org, files: unknown): Promise<{ error: string } | { uploads: { key: string; url: string; headers: Record<string, string> }[] }> {
  if (!Array.isArray(files) || files.length === 0) return { uploads: [] };
  if (files.length > org.max_files) return { error: `You can attach up to ${org.max_files} files.` };
  let total = 0;
  const storage = getStorage();
  const uploads: { key: string; url: string; headers: Record<string, string> }[] = [];
  for (const f of files) {
    const mime = typeof f?.mime === 'string' ? f.mime : '';
    const size = Number(f?.size);
    const kind = kindOfClaimedMime(mime);
    if (!kind || !Number.isInteger(size) || size <= 0) return { error: `Unsupported file type. Allowed: photos, video, audio and PDF.` };
    if (size > capBytes(org, kind)) return { error: `A ${kind} file is over the ${capBytes(org, kind) / 1048576} MB limit.` };
    total += size;
    const key = `quarantine/${randomUUID()}`;
    uploads.push({ key, ...(await storage.presignPut(key, mime, size)) });
  }
  if (total > org.tip_mb * 1048576) return { error: `Total attachments are over the ${org.tip_mb} MB limit.` };
  return { uploads };
}

/**
 * Turns quarantined raw uploads into sanitized evidence: sniff real type -> strip ALL metadata -> store under media/
 * -> record row -> delete the raw original. Anything that fails is dropped, never stored unsanitized.
 */
export async function ingest(org: Org, tipUuid: string, keys: unknown): Promise<{ stored: number; failed: number }> {
  const storage = getStorage();
  const list = [...new Set(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [])].slice(0, org.max_files);
  let stored = 0;
  let failed = 0;
  let total = 0;
  for (const key of list) {
    try {
      if (!QUARANTINE_KEY.test(key)) throw new MediaError('bad key');
      const head = await storage.head(key);
      if (!head || head.size > org.av_mb * 1048576) throw new MediaError('missing or oversize');
      const clean = await sanitize(await storage.get(key));
      total += head.size;
    if (head.size > capBytes(org, clean.kind) || total > org.tip_mb * 1048576) throw new MediaError('over limit');
      const finalKey = `media/${org.id}/${tipUuid}/${randomUUID()}.${clean.ext}`;
      await storage.put(finalKey, clean.data, clean.mime);
      await withOrg(org.id, (q) =>
        q('insert into media (org_id, tip_id, kind, mime, size_bytes, storage_key) values ($1, $2, $3, $4, $5, $6)', [org.id, tipUuid, clean.kind, clean.mime, clean.data.length, finalKey]),
      );
      stored++;
    } catch {
      failed++;
    } finally {
      if (QUARANTINE_KEY.test(key)) await storage.delete(key).catch(() => {});
    }
  }
  return { stored, failed };
}

export { ACCEPT };
