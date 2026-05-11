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
