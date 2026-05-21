import { marked } from 'marked';
import type { EmailMessageData } from './defineEmailChannel';

export type BuildReplyEmailParams = {
  /** The email we're replying to. */
  inReplyTo: EmailMessageData;
  /** Date of the email we're replying to — used for the attribution line. */
  inReplyToDate?: string;
  /** Our channel address (becomes the From: of the reply). */
  fromAddress: string;
  /** Reply body as markdown. */
  text: string;
};

/**
 * Build an EmailMessageData for a reply: subject Re: chain, In-Reply-To /
 * References headers, and text + HTML bodies with the original email quoted
 * underneath in standard mail-client format.
 */
export async function buildReplyEmail(params: BuildReplyEmailParams): Promise<EmailMessageData> {
  const { inReplyTo, inReplyToDate, fromAddress, text } = params;

  const replyTo = inReplyTo.from;
  if (!replyTo) {
    throw new Error(`Cannot build reply email: previous email has no 'from' address`);
  }

  const originalSubject = inReplyTo.subject ?? '';
  const subject = originalSubject
    ? (originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`)
    : 'No subject';

  const inReplyToHeader = inReplyTo.messageId || undefined;

  // Build References chain: prior references + the prior message's own id.
  let references: string[] | undefined;
  if (inReplyTo.references || inReplyTo.messageId) {
    references = [...(inReplyTo.references ?? [])];
    if (inReplyTo.messageId && !references.includes(inReplyTo.messageId)) {
      references.push(inReplyTo.messageId);
    }
  }

  // The attribution ("On <date>, <from> wrote:") is what email clients like
  // Gmail use to detect and collapse quoted text behind "..." in threaded view.
  const dateStr = inReplyToDate ? new Date(inReplyToDate).toUTCString() : undefined;
  const attribution = dateStr
    ? `On ${dateStr}, ${replyTo} wrote:`
    : `${replyTo} wrote:`;

  let textBody = text;
  const quotedText = inReplyTo.textBody;
  if (quotedText) {
    const quoted = quotedText.split('\n').map((line) => `> ${line}`).join('\n');
    textBody = `${textBody}\n\n${attribution}\n${quoted}`;
  }

  const replyHtml = await marked.parse(text);
  let htmlBody = replyHtml;
  const quotedHtml = inReplyTo.htmlBody || inReplyTo.textBody;
  if (quotedHtml) {
    htmlBody += `<div class="gmail_quote"><p>${attribution}</p><blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">${quotedHtml}</blockquote></div>`;
  }

  return {
    messageId: `${crypto.randomUUID()}@${fromAddress}`,
    to: replyTo,
    from: fromAddress,
    subject,
    textBody,
    htmlBody,
    inReplyTo: inReplyToHeader,
    references,
  };
}
