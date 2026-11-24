// Mama's email frame: cream paper, a serif title, her handwritten note on a yellow sticky, one tomato button, and
// her sign-off. Inline styles only (email clients); the web fonts load where supported (Apple Mail, iOS) and fall
// back to Georgia / a cursive face elsewhere, which still reads as a note.
export const PAPER = "#fffcf7";
export const INK = "#231a14";
export const MUTED = "#7a6a5c";
export const TOMATO = "#c93a24";
export const NOTE = "#ffe58a";
export const NOTE_INK = "#4a3505";
const SERIF = "Gloock,Georgia,'Times New Roman',serif";
const SANS = "Jost,Helvetica,Arial,sans-serif";
const HAND = "Caveat,'Bradley Hand','Segoe Print','Comic Sans MS',cursive";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type MamaMail = {
  preheader: string;
  photo?: { src: string; alt: string };
  note: string; // Mama's handwriting on the sticky: 24 characters at most, one line in the fallback cursive
  title: string;
  paragraphs: string[]; // plain text, escaped here
  cta: { label: string; href: string };
  after?: string; // small line under the button
  footer?: string;
};

export function mamaFrame(m: MamaMail): string {
  if (m.note.length > 24) throw new Error(`mamaFrame: note over 24 characters: ${m.note}`);
  const paras = m.paragraphs
    .map((p) => `<tr><td style="font-size:19px;line-height:1.55;font-family:${SANS};color:${INK};padding-bottom:16px;">${esc(p)}</td></tr>`)
    .join("");
  const photo = m.photo
    ? `<tr><td style="padding:0 0 22px 0;"><img src="${esc(m.photo.src)}" alt="${esc(m.photo.alt)}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border-radius:16px;" /></td></tr>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" />
<meta name="color-scheme" content="light dark" /><meta name="supported-color-schemes" content="light dark" />
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=Gloock&family=Jost:wght@400;600&display=swap" rel="stylesheet" />
<title>${esc(m.title)}</title></head>
<body bgcolor="${PAPER}" style="margin:0;padding:0;background:${PAPER};color:${INK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(m.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${PAPER}" style="background:${PAPER};"><tr><td align="center" style="padding:32px 16px 40px;">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;text-align:left;">
<tr><td style="font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};font-family:${SANS};padding-bottom:18px;">Cooking with your Mom</td></tr>
${photo}
<tr><td style="padding-bottom:22px;"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="${NOTE}" style="background:${NOTE};color:${NOTE_INK};font-family:${HAND};font-size:30px;line-height:1.15;padding:14px 20px 12px;border-radius:3px;border:1px solid #e9cf6a;">${esc(m.note)}<div style="text-align:right;font-size:24px;padding-top:4px;">— Mama</div></td></tr></table></td></tr>
<tr><td style="font-family:${SERIF};font-size:36px;line-height:1.15;font-weight:400;color:${INK};padding-bottom:16px;">${esc(m.title)}</td></tr>
${paras}
<tr><td style="padding:10px 0 ${m.after ? "12px" : "28px"};"><a href="${esc(m.cta.href)}" style="display:inline-block;background:${TOMATO};color:${PAPER};text-decoration:none;font-family:${SANS};font-weight:600;font-size:19px;padding:16px 30px;border-radius:999px;border:2px solid ${TOMATO};">${esc(m.cta.label)}</a></td></tr>
${m.after ? `<tr><td style="font-size:16px;line-height:1.5;color:${MUTED};font-family:${SANS};padding-bottom:28px;">${esc(m.after)}</td></tr>` : ""}
${m.footer ? `<tr><td style="font-size:14px;line-height:1.5;color:${MUTED};font-family:${SANS};padding-top:22px;border-top:1px solid #eadfd2;">${esc(m.footer)}</td></tr>` : ""}
</table></td></tr></table></body></html>`;
}
