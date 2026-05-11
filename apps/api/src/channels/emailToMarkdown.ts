import * as planer from 'planer';
import { JSDOM } from 'jsdom';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

declare module 'planer';

const dom = new JSDOM().window.document;
const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

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
    return td.turndown($.html()).trim();
  }
  if (email.text) {
    return planer.extractFrom(email.text, 'text/plain').trim();
  }
  return '';
}
