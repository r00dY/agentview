import { OpenAPIHono } from '@hono/zod-openapi';
import { Resend } from 'resend';
import { log } from '../../logger';
import type { EmailChannelProvider, EmailMessageData } from '../defineEmailChannel';

const resend = new Resend(process.env.RESEND_API_KEY);

/** Extract bare email from "Name <email>" or just "email" */
function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

export function createResendRoutes(provider: EmailChannelProvider): OpenAPIHono {
  const app = new OpenAPIHono();

  app.post('/webhook', async (c) => {
    const body = await c.req.json();

    if (body.type !== 'email.received') {
      log.info({ type: body.type }, 'resend webhook: ignoring non-received event');
      return c.json({ status: 'ok' }, 200);
    }

    const emailId: string | undefined = body.data?.email_id;
    if (!emailId) {
      log.warn('resend webhook: no email_id in payload');
      return c.json({ status: 'ok' }, 200);
    }

    // Webhook only has metadata — fetch full email content
    const { data: email, error } = await resend.emails.receiving.get(emailId);
    if (error || !email) {
      log.error({ emailId, error }, 'resend webhook: failed to fetch received email');
      return c.json({ error: 'Failed to fetch email' }, 500);
    }

    log.info({ emailId, from: email.from, to: email.to, subject: email.subject }, 'resend webhook: processing received email');

    const toAddresses = email.to ?? [];
    const headers = email.headers ?? {};

    // In-Reply-To and References come from email headers
    const inReplyTo = headers['in-reply-to'] || undefined;

    // RESEND BUG/QUIRK: Resend's receiving API returns the References header as a
    // stringified JSON array (e.g. '["<id1@x.com>","<id2@x.com>"]') instead of the
    // standard RFC 2822 space-separated format ("<id1@x.com> <id2@x.com>").
    // The SDK types say `headers: Record<string, string>` but the value for
    // "references" is actually a JSON-encoded array.
    //
    // This is critical for threading: resolveThreadId uses References to match
    // incoming replies against existing messages. If we naively split on whitespace
    // (like you'd do with RFC format), we get a single garbled string that never
    // matches any sourceId, and every reply creates a new thread.
    //
    // We parse as JSON first, fall back to RFC space-split for safety.
    const rawReferences = headers['references'];
    let references: string[] | undefined;
    if (rawReferences) {
      try {
        const parsed = JSON.parse(rawReferences);
        if (Array.isArray(parsed)) {
          references = parsed;
        }
      } catch {
        references = rawReferences.split(/\s+/).filter(Boolean);
      }
    }

    // Ingest for each recipient address (each may map to a different channel)

    // We take first address that has 'agent.agentview.app' domain
    let address: string | undefined = undefined;

    for (const toAddress of toAddresses) {
      const emailAddress = extractEmailAddress(toAddress);
      if (emailAddress.split('@')[1] === 'agent.agentview.app') {
        address = emailAddress;
        break;
      }
    }

    if (!address) {
      log.warn({ emailId }, 'resend webhook: no agentview email address found');
      return c.json({ status: 'ok' }, 200);
    }

    const agentViewEmail : EmailMessageData = {
      messageId: email.message_id,
      inReplyTo,
      references,
      subject: email.subject,
      from: email.headers.from,
      to: toAddresses.join(', '),
      cc: email.cc?.join(', '),
      htmlBody: email.html ?? undefined,
      textBody: email.text ?? undefined,
    };

    try {
      await provider.ingestEmail(address, {
        date: email.created_at,
        email: agentViewEmail,
        providerData: {
          resendEmailId: emailId,
        },
      });
    } catch (error) {
      console.log("--- ingestEmail error ---");
      console.log(error);
      log.error({ err: error, address }, 'resend webhook: failed to ingest email');
      // return c.json({ error: 'Failed to ingest email' }, 500);
    }

    return c.json({ status: 'ok' }, 200);
  });

  return app;
}
