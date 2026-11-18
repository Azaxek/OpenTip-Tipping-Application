import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import QRCode from 'qrcode';
import type { Org } from './org';
import { appUrl } from './url';

export const submitUrl = () => `${appUrl()}/submit`;

export const qrPng = (url: string) => QRCode.toBuffer(url, { width: 900, margin: 2, errorCorrectionLevel: 'M' });

// Standard PDF fonts only cover Latin-1 plus a few typographic marks; anything else would make pdf-lib throw.
const safe = (s: string) => s.replace(/[^\t\n\x20-\x7E\xA0-\xFF‘’“”–—…•]/g, '?');

function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const lines: string[] = [];
  for (const para of safe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > max && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

const hex = (c: string) => rgb(parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255);

export async function posterPdf(org: Org): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const brand = hex(org.primary_color);
  const center = (t: string, y: number, size: number, f: PDFFont, color = rgb(0.1, 0.1, 0.1)) => {
    const s = safe(t);
    page.drawText(s, { x: (612 - f.widthOfTextAtSize(s, size)) / 2, y, size, font: f, color });
  };
  page.drawRectangle({ x: 0, y: 662, width: 612, height: 130, color: brand });
  center('SEE SOMETHING?', 730, 44, bold, rgb(1, 1, 1));
  center('SAY SOMETHING.', 682, 44, bold, rgb(1, 1, 1));
  center(org.name, 620, 26, bold, brand);
  center('Submit an anonymous tip - no name, no phone number, no tracking.', 585, 15, font);
  const qr = await doc.embedPng(await qrPng(submitUrl()));
  page.drawImage(qr, { x: 156, y: 200, width: 300, height: 300 });
  center('Scan with your phone camera', 170, 16, bold);
  center(submitUrl(), 148, 12, font, rgb(0.3, 0.3, 0.3));
  if (org.hotline) center(`Or call: ${org.hotline}`, 110, 18, bold, brand);
  center('In an emergency or if someone is in immediate danger, call 911. This tip line is not monitored in real time.', 60, 10, font, rgb(0.35, 0.35, 0.35));
  return doc.save();
}

export function defaultLetter(org: Org): string {
  const campus = org.org_type === 'campus';
  return `Dear ${campus ? 'Parents and Guardians' : 'Neighbors'},

${campus ? 'Keeping our students safe is a responsibility we share.' : 'Safer communities start with neighbors who speak up.'} ${org.name} offers a free, anonymous way to report ${campus ? 'bullying, threats, safety concerns, or a friend who may need help' : 'crime or safety concerns'}.

How it works:
- Visit ${submitUrl()} or scan the QR code on our posters.
- Describe what you know. You never have to give your name, and we do not record who you are or what device you use.
- You receive a TIP ID and a passcode you choose. Use them to check back and to chat with a reviewer - still anonymously.

${campus ? 'Please talk with your child about this resource and when to use it.' : 'Please share this resource with people you know.'}
${org.hotline ? `\nYou can also reach us at ${org.hotline}.\n` : ''}
This form is not monitored in real time. If someone is in immediate danger, call 911.

Thank you for helping keep us safe.

${org.name}`;
}

export async function letterPdf(org: Org, body: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = wrap(body.slice(0, 8000), font, 11, 468);
  let page = doc.addPage([612, 792]);
  page.drawText(safe(org.name), { x: 72, y: 720, size: 18, font: bold, color: hex(org.primary_color) });
  let y = 690;
  for (const l of lines) {
    if (y < 72) { page = doc.addPage([612, 792]); y = 720; }
    page.drawText(l, { x: 72, y, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
    y -= 15;
  }
  return doc.save();
}

export type Announcement = { id: string; title: string; use: string; text: string };

/**
 * Ready-to-paste texts for launching the tip line: the poster and letter reach people who walk past or are sent something, these reach
 * the rest (the local paper, a morning announcement, social media, the people who will answer tips). Square brackets mark what only the
 * program knows and must be filled in before use.
 */
export function announcements(org: Org): Announcement[] {
  const campus = org.org_type === 'campus';
  const who = campus ? 'students, families and staff' : 'neighbors';
  const url = submitUrl();
  const phone = org.hotline ? ` You can also call ${org.hotline}.` : '';
  const emergency = 'If someone is in danger right now, call 911. This tip line is not watched in real time.';
  return [
    {
      id: 'press',
      title: 'News release for local media',
      use: 'Send to the local paper, radio and community newsletters the week you launch.',
      text: `FOR IMMEDIATE RELEASE
[DATE]

${org.name} launches a free, anonymous tip line

[CITY] — ${org.name} today announced a free way for ${who} to share safety concerns without giving their name. Tips can be sent any time from a phone or computer at ${url}.

The tip line does not ask for a name or phone number, and the website does not record the device or location of the person sending a tip. After sending, a person receives a TIP ID and a passcode they can use to check back and answer follow-up questions, still anonymously.

"[QUOTE FROM THE DIRECTOR OR PRINCIPAL ABOUT WHY THIS MATTERS]" said [NAME, TITLE].

Tips are reviewed by [WHO REVIEWS TIPS]. ${emergency}${phone}

Media contact: [NAME, EMAIL, PHONE]`,
    },
    {
      id: 'announcement',
      title: 'Thirty-second announcement',
      use: 'Read aloud at an assembly, a meeting or on the morning announcements. Say it more than once: people forget.',
      text: `Quick reminder about something that is here for you. ${org.name} has an anonymous tip line. If you see or hear something that worries you${campus ? ' — bullying, a threat, someone who is hurting' : ''} — you can tell us without giving your name.

Go to ${url}, or scan the code on the posters. There is no account and nothing that says who you are. You get a TIP ID so you can check back and talk with us, still anonymously.

${emergency}`,
    },
    {
      id: 'social',
      title: 'Social media post',
      use: 'Short enough for most networks.',
      text: `See something? Say something. ${org.name}'s tip line is free and anonymous: ${url}. No name, no phone number, no tracking. In an emergency call 911.`,
    },
    {
      id: 'team',
      title: 'Introduction for the people who answer tips',
      use: 'Send to everyone you add under People, before launch day.',
      text: `Subject: You are on the ${org.name} tip line team

Hello,

You can now sign in to the tip line console at ${appUrl()}/staff. Please open Help first (it takes five minutes) and turn on two-step sign-in under your name.

What to expect:
- You see tips for the teams you belong to. Urgent and high-risk tips are marked in red.
- Reply to a tipster in the chat. They never see your name. Ask for what you need (where, when, who) and never ask who they are.
- ${org.response_target_hours ?? 24} hours is our reply target. If a tip is overdue it shows in red.
- Alert emails never contain what the tipster wrote. They only say a tip arrived, with a link.
- If someone may be in danger right now, use Escalate now and make sure 911 has been called.

Questions go to [NAME, EMAIL].

${org.name}`,
    },
  ];
}
