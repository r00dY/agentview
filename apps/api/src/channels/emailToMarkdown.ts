/**
 * Email -> Markdown converter for LLM consumption.
 *
 * The goal: take a raw email (HTML + text) and produce clean markdown that
 * an LLM can reason about — no quoted replies, no signatures, no styling junk.
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
 *   regardless of language. It also strips signatures.
 *
 * Pipeline:
 *   1. Prefer HTML over text (HTML preserves tables, lists, links).
 *   2. planer.extractFrom(html, 'text/html') — strips quoted replies and
 *      signatures using DOM-level detection (gmail_quote, blockquote, etc).
 *   3. cheerio cleanup — remove vendor-specific quote containers that planer
 *      might miss (Protonmail, Yahoo, Thunderbird), plus <style>/<script>.
 *   4. Patch headerless tables — Gmail/Sheets paste tables as <tbody>/<td>
 *      without <thead>/<th>. Turndown's GFM plugin requires <th> to produce
 *      markdown tables, so we inject empty header rows.
 *   5. Turndown + GFM plugin — convert cleaned HTML to markdown with proper
 *      tables, strikethrough, and task lists.
 *   6. Fall back to planer plaintext extraction if HTML is missing or trivial.
 *
 * When to revisit:
 *   When you see actual bad output in production, look at the email HTML,
 *   then decide: add another selector to EXTRA_VENDOR_QUOTES, or route that
 *   case to an LLM. Not before.
 */

/**
 * ANOTHER SUMMARY FROM CLAUDE
 * 
 * ## What you do

**1. Install planer + jsdom + turndown**

```bash
npm i planer jsdom turndown
npm i -D @types/jsdom @types/turndown
```

**2. Write this file** (~30 lines including types):

```ts
// email-to-markdown.ts
import * as planer from 'planer';
import { JSDOM } from 'jsdom';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

declare module 'planer'; // planer has no types

const dom = new JSDOM().window.document;
const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

const EXTRA_VENDOR_QUOTES = [
  '.protonmail_quote', '.yahoo_quoted', '.zmail_extra', '.moz-cite-prefix'
].join(',');

export function emailToMarkdown(email: { html?: string; text?: string }): string {
  const html = email.html?.trim();
  if (html && html.replace(/<[^>]+>/g, '').trim().length > 20) {
    const cleaned = planer.extractFrom(html, 'text/html', dom);
    const $ = cheerio.load(cleaned);
    $(EXTRA_VENDOR_QUOTES).remove();
    $('style, script').remove();
    return td.turndown($.html()).trim();
  }
  if (email.text) {
    return planer.extractFrom(email.text, 'text/plain').trim();
  }
  return '';
}
```

**3. Wire it to your Resend webhook**: pass `{ html: payload.html, text: payload.text }` in, get markdown out.

**4. Ship it. Stop thinking about quote stripping.**

## What you don't do

- Don't write custom selector logic. Planer's checkpoint algorithm is better than what you'd write.
- Don't add LLM fallback now. Wait until you see real failures.
- Don't worry about Polish. Planer has it baked in.
- Don't worry about the 2-year-old npm publish. Email client conventions don't change.

## When to revisit

When you see actual bad output in production, look at the email, then decide: add another selector to `EXTRA_VENDOR_QUOTES`, or route that case to an LLM. Not before.

That's it.
 */
import * as planer from 'planer';
import { JSDOM } from 'jsdom';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

declare module 'planer';
declare module 'turndown-plugin-gfm';

const dom = new JSDOM().window.document;
const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
td.use(gfm);

const EXTRA_VENDOR_QUOTES = [
  '.protonmail_quote',
  '.yahoo_quoted',
  '.zmail_extra',
  '.moz-cite-prefix',
].join(',');

export function emailToMarkdown(email: { html?: string; text?: string }): string {
  const html = email.html?.trim();
  if (html && html.replace(/<[^>]+>/g, '').trim().length > 20) {
    const cleaned = planer.extractFrom(html, 'text/html', dom);
    const $ = cheerio.load(cleaned);
    $(EXTRA_VENDOR_QUOTES).remove();
    $('style, script').remove();

    // Turndown GFM plugin needs <thead>/<th> to produce markdown tables.
    // Gmail/Sheets tables only have <tbody>/<td>, so inject an empty header row.
    $('table').each((_, table) => {
      const $table = $(table);
      if ($table.find('thead').length === 0) {
        const colCount = $table.find('tr').first().children('td, th').length;
        if (colCount > 0) {
          const ths = '<th></th>'.repeat(colCount);
          $table.prepend(`<thead><tr>${ths}</tr></thead>`);
        }
      }
    });

    return td.turndown($.html()).trim();
  }
  if (email.text) {
    return planer.extractFrom(email.text, 'text/plain').trim();
  }
  return '';
}
