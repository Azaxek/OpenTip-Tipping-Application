/** Browser-side receipt card. Built entirely on the device so the TIP ID never makes an extra network trip. */
export async function downloadTipCard(orgName: string, tipId: string, m: { cardTitle: string; cardTipId: string; cardHow: string; cardNoPass: string; cardPrivate: string }) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([226, 340]); // small receipt
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?'); // the built-in PDF font covers basic Latin and Latin-1 (accents, ñ, ¿, ¡)
  const wrap = (text: string, size: number, max: number) => {
    const out: string[] = [];
    let line = '';
    for (const w of safe(text).split(' ')) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > max && line) { out.push(line); line = w; } else line = next;
    }
    return [...out, line];
  };
  const center = (t: string, y: number, size: number, f = font) => page.drawText(t, { x: (226 - f.widthOfTextAtSize(t, size)) / 2, y, size, font: f });

  center(safe(orgName).slice(0, 34), 310, 11, bold);
  center(safe(m.cardTitle), 294, 9);
  page.drawLine({ start: { x: 16, y: 284 }, end: { x: 210, y: 284 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
  center(safe(m.cardTipId), 262, 9, bold);
  center(tipId, 236, 20, mono);
  page.drawLine({ start: { x: 16, y: 222 }, end: { x: 210, y: 222 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
  let y = 204;
  const url = `${window.location.origin}/check`;
  for (const l of [
    ...wrap(m.cardHow.replace('{url}', url), 9, 194),
    '',
    ...wrap(m.cardNoPass, 9, 194),
    '',
    ...wrap(m.cardPrivate, 9, 194),
  ]) {
    page.drawText(l, { x: 16, y, size: 9, font });
    y -= 12;
  }
  const bytes = await doc.save();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  a.download = 'tip-receipt.pdf';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
