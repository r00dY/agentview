import { db } from "./db";
import { emails } from "./schemas/schema";
import type { EmailPayload } from "./types";

export async function addEmail(emailPayload: EmailPayload, userId: string) {
  const to = Array.isArray(emailPayload.to) ? emailPayload.to.join(', ') : emailPayload.to;
  const cc = emailPayload.cc ? (Array.isArray(emailPayload.cc) ? emailPayload.cc.join(', ') : emailPayload.cc) : undefined;
  const bcc = emailPayload.bcc ? (Array.isArray(emailPayload.bcc) ? emailPayload.bcc.join(', ') : emailPayload.bcc) : undefined;

  await db.insert(emails).values({
    id: crypto.randomUUID(),
    user_id: userId,
    to,
    subject: emailPayload.subject,
    body: emailPayload.html,
    text: emailPayload.text,
    from: emailPayload.from || 'noreply@example.com',
    cc,
    bcc,
    reply_to: emailPayload.replyTo,
    created_at: new Date(),
    updated_at: new Date(),
  });
}
