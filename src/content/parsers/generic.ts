import type { SiteParser } from './base';
import { cleanText, extractChapterFromRoot, hrefOf } from './base';
import type { ParsedChapter } from '../../shared/types';

/**
 * Generic parser: scores candidate elements by text density
 * (text length / total element length) and picks the winner.
 * Works reasonably well on most article/chapter pages.
 */
export const GenericParser: SiteParser = {
  id: 'generic',
  canHandle(): boolean {
    return true; // always a fallback
  },

  extract(options): ParsedChapter | null {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'article, main, [role="main"], .content, #content, ' +
        '.chapter, #chapter, .entry-content, .post-content, ' +
        '.story-content, .text-content, .prose',
      ),
    );

    // Also try large divs/sections not caught above
    document.querySelectorAll<HTMLElement>('div, section').forEach(el => {
      const text = el.innerText ?? '';
      if (text.length > 2000) candidates.push(el);
    });

    if (candidates.length === 0) return null;

    // Score: favor elements with lots of text relative to total HTML length
    const scored = candidates.map(el => {
      const textLen = (el.innerText ?? '').length;
      const htmlLen = el.innerHTML.length;
      const score = htmlLen > 0 ? textLen / htmlLen : 0;
      return { el, score, textLen };
    });

    scored.sort((a, b) => b.score * Math.log(b.textLen + 1) - a.score * Math.log(a.textLen + 1));

    const best = scored[0];
    if (!best || best.textLen < 200) return null;

    const text = cleanText(best.el, options);
    if (!text || text.length < 200) return null;

    const title =
      (document.querySelector('h1') as HTMLElement | null)?.innerText.trim() ??
      document.title;

    return extractChapterFromRoot(best.el, {
      title,
      site: 'generic',
      prevChapterUrl: hrefOf('[rel="prev"], a[href*="prev"], a[href*="previous"]'),
      nextChapterUrl: hrefOf('[rel="next"], a[href*="next"]'),
    }, options);
  },
};
