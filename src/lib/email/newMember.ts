// The heads-up the owner gets when someone lands on the waitlist: one short note, one button to /admin. Sent through
// Resend's REST API like welcome.ts; without RESEND_API_KEY nothing is sent and the caller is told. Never throws.

import { APP_URL } from "./welcome";
import { mamaFrame } from "./frame";

const RESEND_URL = "https://api.resend.com/emails";
const FROM = () => process.env.WELCOME_FROM ?? "Mama at Cooking with your Mom <mama@example.com>";

export type NewMemberInput = { email: string; ref: string | null; userId: string };
export type NewMemberResult = { sent: boolean; reason?: string };

export function newMemberEmail(input: { email: string; ref: string | null; appUrl?: string }): { subject: string; text: string; html: string } {
  const appUrl = (input.appUrl ?? APP_URL).replace(/\/+$/, "");
  const from = input.ref ? ` (came in through ${input.ref})` : "";
  const subject = `${input.email} is on Mama's list`;
  const paragraph = `Someone just pulled up a chair: ${input.email}${from}. Open the kitchen and let them in when you're ready: ${appUrl}/admin`;
  const text = [paragraph, "", "— Mama"].join("\n");
  const html = mamaFrame({
    preheader: `${input.email} is waiting for a seat.`,
    note: "New at the table",
    title: "Someone's on the list.",
    paragraphs: [paragraph],
    cta: { label: "Open the kitchen", href: `${appUrl}/admin` },
  });
  return { subject, text, html };
}

export async function notifyNewMember(input: NewMemberInput, fetchImpl: typeof fetch = fetch): Promise<NewMemberResult> {
  try {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { sent: false, reason: "no_key" };
    const to = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (to.length === 0) return { sent: false, reason: "no_admins" };
    const mail = newMemberEmail({ email: input.email, ref: input.ref });
    // One request per admin: a bad address (Resend 422) must not block the others. Idempotent per admin and member.
    const results = await Promise.all(
      to.map(async (admin, i) => {
        const res = await fetchImpl(RESEND_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "Idempotency-Key": `new-member-${input.userId}-${i}` },
          body: JSON.stringify({ from: FROM(), to: [admin], reply_to: input.email, subject: mail.subject, text: mail.text, html: mail.html }),
          signal: AbortSignal.timeout(15000),
        });
        return res.ok ? null : `resend_${res.status}`;
      }),
    );
    const failed = results.filter((r): r is string => r !== null);
    if (failed.length === results.length) return { sent: false, reason: failed[0] };
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message.slice(0, 80) : "network" };
  }
}
