/**
 * Email -> Markdown converter for LLM consumption.
 *
 * The goal: take a raw email (HTML + text) and produce clean markdown that
 * an LLM can reason about — no quoted replies, no styling junk — plus a
 * structured signature extracted separately.
 *
 * Why this approach:
 *   We tried email-reply-parser first (JS port of GitHub's parser). It works
 *   by regex-matching attribution lines ("On ... wrote:"). Problem: those
 *   regexes are language-specific. Polish Gmail produces "pon., 11 maj 2026
 *   o 13:37 ... napisal(a):" which doesn't match the library's Polish pattern
 *   (it only knows "W dniu ... napisal:"). Chasing localized Gmail formats
 *   with custom regexes is a losing game.
 *
 *   Instead we use planer — a JS port of Mailgun's Talon library. Talon uses
 *   a checkpoint algorithm on the HTML DOM rather than regexing the text, so
 *   it handles Gmail/Outlook/Yahoo/Protonmail quote blocks structurally
 *   regardless of language.
 *
 *   For signature extraction + markdown conversion we pass the cleaned content
 *   through a cheap LLM (gpt-5-mini). Planer doesn't reliably strip signatures
 *   from HTML (it only targets quote blocks, not gmail_signature class etc.),
 *   and trying to handle every email client's signature markup with selectors
 *   is a losing game. The LLM sees both the HTML and text, extracts structured
 *   signature data (name, one-liner, extra info), and converts the content body
 *   to clean markdown — preserving the original wording exactly.
 *
 * Pipeline:
 *   1. planer strips quoted replies from HTML (gmail_quote, blockquote, etc.)
 *   2. cheerio removes vendor-specific quote containers planer might miss
 *      (Protonmail, Yahoo, Thunderbird) plus <style>/<script>
 *   3. LLM (gpt-5-mini via ai-sdk) receives the cleaned HTML + text and returns:
 *      - content: the email body as clean markdown (verbatim wording, just restyled)
 *      - signature: structured { name, oneLiner, extra } or null
 *   4. Falls back to planer-only plaintext extraction if LLM fails
 *
 * When to revisit:
 *   When you see actual bad output in production, look at the email HTML,
 *   then decide: add another selector to EXTRA_VENDOR_QUOTES, tweak the
 *   prompt, or swap models. Not before.
 */
import * as planer from 'planer';
import { JSDOM } from 'jsdom';
import * as cheerio from 'cheerio';
import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { log } from '../logger';

declare module 'planer';

const dom = new JSDOM().window.document;

const EXTRA_VENDOR_QUOTES = [
  '.protonmail_quote',
  '.yahoo_quoted',
  '.zmail_extra',
  '.moz-cite-prefix',
].join(',');

const emailSchema = z.object({
  content: z.string().describe('The email body converted to clean markdown. Must preserve the original wording exactly — only change formatting/styling to markdown.'),
  user: z.nullable(z.object({
    name: z.string().describe('Full name of the sender. Empty string if unknown.'),
    headline: z.string().describe('A single-line description displayed under the name. Usually role/title and company (e.g. "Co-Founder, Commerce-UI"), but could be any short descriptor that best identifies who this person is. Empty string if unknown.'),
    details: z.string().describe('Other genuinely useful info: phone, website, address, etc. Empty string if none.'),
  })).describe('Sender identity extracted from the email signature. null if no signature present.'),
});

export type EmailParseResult = z.infer<typeof emailSchema>;

const SYSTEM_PROMPT = `You extract content and signature from emails. Think of yourself as a noise filter — keep the meat, drop the junk.

You receive the cleaned email body (HTML and/or text). Your job:

1. CONTENT: Convert the email body to clean markdown.
   - Preserve the original wording EXACTLY. Do not paraphrase, summarize, or add anything.
   - Only change styling: HTML tags become markdown (bold, links, lists, tables, etc.)
   - Remove the signature from the content (extract it separately — see below).
   - Strip out noise that isn't part of the actual message: tracking pixels, spacer images, legal disclaimers, confidentiality notices, unsubscribe links, "sent from my iPhone" lines, social media icon links, banner images, attribution lines from quoted replies (e.g. "On <date>, <name> wrote:"), etc.

2. USER: Extract the sender's identity from the email signature. Return null if no signature is present.
   - name: the person's full name
   - headline: a single-line description that best identifies who this person is — usually role/title and company (e.g. "Co-Founder, Commerce-UI"), but could be anything that fits as a one-liner under their name
   - details: other genuinely useful contact info (phone, email, website, address) — as a short string
   - Drop everything else: logos, banners, social media links, legal text, promotional taglines, "think before you print" messages, etc. These are noise.`;

export async function emailToMarkdown(email: { html?: string; text?: string }): Promise<EmailParseResult> {
  // Step 1: Strip quoted replies with planer
  let cleanedHtml: string | undefined;
  const html = email.html?.trim();
  if (html && html.replace(/<[^>]+>/g, '').trim().length > 20) {
    const extracted = planer.extractFrom(html, 'text/html', dom);
    const $ = cheerio.load(extracted);
    $(EXTRA_VENDOR_QUOTES).remove();
    $('style, script').remove();
    cleanedHtml = $.html();
  }

  let cleanedText: string | undefined;
  if (email.text) {
    cleanedText = planer.extractFrom(email.text, 'text/plain').trim();
  }

  // Build prompt with what we have
  const parts: string[] = [];
  if (cleanedHtml) {
    parts.push(`<html_body>\n${cleanedHtml}\n</html_body>`);
  }
  if (cleanedText && !cleanedHtml) {
    parts.push(`<text_body>\n${cleanedText}\n</text_body>`);
  }

  if (parts.length === 0) {
    return { content: '', user: null };
  }

  console.log('-------------------EMAIL TO MARKDOWN--------------');

  // Step 2: LLM extraction
  try {
    const { output } = await generateText({
      model: openai('gpt-5-mini'),
      system: SYSTEM_PROMPT,
      prompt: parts.join('\n\n'),
      output: Output.object({ schema: emailSchema }),
    });

    console.log('output', output);

    if (output) {
      return output;
    }
  } catch (error) {
    console.log('error', error);
    log.warn({ error }, 'emailToMarkdown: LLM extraction failed, falling back to planer');
  }

  // Fallback: return planer output as-is
  return { content: cleanedText || '', user: null };
}
