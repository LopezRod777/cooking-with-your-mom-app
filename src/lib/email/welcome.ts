// The welcome Mama sends when a spot opens. Short, warm, one button (the shape of Raya's "Welcome" note, in
// Mama's voice). Sent through Resend's REST API; without RESEND_API_KEY nothing is sent and the caller is told.

const RESEND_URL = "https://api.resend.com/emails";
import { mamaFrame } from "./frame";

// Where the button goes. WELCOME_APP_URL wins, then a non-empty https app origin, then production. (An empty
// NEXT_PUBLIC_APP_ORIGIN in .env.local once produced a button with no link.)
function pickAppUrl(): string {
  for (const v of [process.env.WELCOME_APP_URL, process.env.NEXT_PUBLIC_APP_ORIGIN]) {
    if (v && /^https:\/\/[^\s/]+/.test(v)) return v.replace(/\/+$/, "");
  }
  return "https://cookingwithyourmom.zouthrock.com";
}
export const APP_URL = pickAppUrl();
const FROM = () => process.env.WELCOME_FROM ?? "Mama at Cooking with your Mom <mama@example.com>";
const REPLY_TO = () => process.env.WELCOME_REPLY_TO ?? "hello@example.com";

export type WelcomeInput = { to: string; firstName: string | null; userId: string };
export type WelcomeResult = { sent: true; id: string } | { sent: false; reason: string };


export function welcomeEmail(firstName: string | null, appUrl = pickAppUrl()): { subject: string; text: string; html: string } {
  const name = (firstName ?? "").trim().slice(0, 40) || "honey";
  const subject = `You’re in, ${name}. Mama saved you a seat.`;
  const host = appUrl.replace(/^https?:\/\//, "");
  const paragraphs = [
    "Tell Mama who’s eating and what’s in your kitchen, and she plans your week: dinners, one shopping list with prices, and every recipe step by step.",
    "It’s free, and we’re still testing it, so a few things may be rough.",
  ];
  const after = "Sign in with the email this note came to.";
  const footer = `Questions, or something broken? Just reply to this email. You’re getting this because you joined the waitlist at ${host} with this email.`;
  const text = [
    `Welcome to the table, ${name}.`,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    `Come on in: ${appUrl}`,
    after,
    "",
    "— Mama",
    "Cooking with your Mom",
    "",
    footer,
  ].join("\n");
  const html = mamaFrame({
    preheader: "Tell Mama who’s eating and she plans your week. Free.",
    photo: { src: `${appUrl}/media/saved-seat.jpg`, alt: "A wooden kitchen table with one place set: plate, napkin, fork and a glass of water, waiting for you." },
    note: "Saved you a seat, honey.",
    title: `Welcome to the table, ${name}.`,
    paragraphs,
    cta: { label: "Come on in", href: appUrl },
    after,
    footer,
  });
  return { subject, text, html };
}

// The note the owner forwards to friends by email (ref=correo). Not sent by the app; rendered for him to copy.
// `name` is how we address the person at the end of the note, as given ("Chef Mike 👨‍🍳"); nothing when unknown.
export function inviteEmail(appUrl = pickAppUrl(), name?: string): { subject: string; text: string; html: string } {
  const link = `${appUrl}/sign-in?ref=correo`;
  const subject = "Mama’s cooking this week. Want a seat?";
  const paragraphs = [
    "Cooking with your Mom plans your week of dinners. Tell Mama who’s eating, what you’re working toward and what you have at home, and you get recipes step by step and one shopping list with prices.",
    "She sets each person’s plate, cooks with you with timers running and a photo for every step if you’re still learning, answers when you ask her something mid-recipe, pairs a drink if you’re 21+, feeds the dog too, and keeps a table where friends share photos and recipes.",
    "It’s free. The table is small for now: join the list and Mama lets a few people in at a time.",
  ];
  const note =
    `Note: once you’ve cooked with Mama a few times, hit reply and tell us how it went, what you’d change, and what you’d honestly be willing to pay for it. We read every reply.${name ? ` Mama’s saving you a seat, ${name}.` : ""}`;
  const text = ["Pull up a chair.", "", ...paragraphs.flatMap((p) => [p, ""]), `Get on the list: ${link}`, "", note, "", "— Mama", "Cooking with your Mom"].join("\n");
  const html = mamaFrame({
    preheader: "A week of dinners planned for you. She lets a few people in at a time.",
    photo: { src: `${appUrl}/media/saved-seat.jpg`, alt: "A wooden kitchen table with one place set: plate, napkin, fork and a glass of water, waiting for you." },
    note: "Want a seat, honey?",
    title: "Pull up a chair.",
    paragraphs,
    cta: { label: "Get on the list", href: link },
    after: note,
  });
  return { subject, text, html };
}

export async function sendWelcome(input: WelcomeInput, fetchImpl: typeof fetch = fetch): Promise<WelcomeResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "no_key" };
  const mail = welcomeEmail(input.firstName);
  let res: Response;
  try {
    res = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "Idempotency-Key": `welcome/${input.userId}` },
      body: JSON.stringify({ from: FROM(), to: [input.to], reply_to: REPLY_TO(), subject: mail.subject, text: mail.text, html: mail.html }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message.slice(0, 80) : "network" };
  }
  if (!res.ok) return { sent: false, reason: `resend_${res.status}` };
  const json = (await res.json().catch(() => null)) as { id?: string } | null;
  return { sent: true, id: json?.id ?? "" };
}
