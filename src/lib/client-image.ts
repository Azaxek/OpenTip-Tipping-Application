/**
 * Browser-side photo shrink: longest side 1600 px, JPEG. A 12 MB phone photo becomes a few hundred KB, which matters on cellular, and
 * the re-encode drops EXIF (camera, GPS) before the file ever leaves the device. The server strips metadata again regardless.
 * Returns the original file if it is not a JPEG/PNG/WebP, if anything fails, or if shrinking would not help.
 */
export async function downscalePhoto(file: File, maxSide = 1600, quality = 0.85): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file); // applies the photo's rotation tag
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff'; // JPEG has no transparency: avoid black where a PNG was clear
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
