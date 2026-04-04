import type { SiteParser } from './base';
import { extractChapterFromRoot, hrefOf, textOf } from './base';
import type { ParsedChapter } from '../../shared/types';

export const WebnovelParser: SiteParser = {
  id: 'webnovel',
  canHandle(url) {
    return /webnovel\.com\/book\//.test(url);
  },

  extract(options): ParsedChapter | null {
    // Webnovel uses a React SPA — content may be in different containers
    const contentEl =
      document.querySelector('.cha-words, .chapter-item, [class*="cha-content"]') ??
      document.querySelector('._content');
    if (!contentEl) return null;

    const title =
      textOf('.cha-tit h3, .chapter-title') ??
      textOf('h3') ??
      document.title;

    return extractChapterFromRoot(contentEl, {
      title,
      site: 'webnovel',
      prevChapterUrl: hrefOf('[class*="prevChapter"], [class*="prev-chapter"]'),
      nextChapterUrl: hrefOf('[class*="nextChapter"], [class*="next-chapter"]'),
    }, options);
  },
};
