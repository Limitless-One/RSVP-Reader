import type { SiteParser } from './base';
import { extractChapterFromRoot, hrefOf, textOf } from './base';
import type { ParsedChapter } from '../../shared/types';

export const ScribbleHubParser: SiteParser = {
  id: 'scribblehub',
  canHandle(url) {
    return /scribblehub\.com\/read\//.test(url);
  },

  extract(options): ParsedChapter | null {
    const contentEl = document.querySelector('.chp_raw, #chp_raw, .wi_body');
    if (!contentEl) return null;

    const title =
      textOf('.chapter-title, .wi_fic_title') ??
      textOf('h1') ??
      document.title;

    return extractChapterFromRoot(contentEl, {
      title,
      site: 'scribblehub',
      prevChapterUrl: hrefOf('.btn-prev, a[rel="prev"]'),
      nextChapterUrl: hrefOf('.btn-next, a[rel="next"]'),
    }, options);
  },
};
