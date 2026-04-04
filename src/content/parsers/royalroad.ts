import type { SiteParser } from './base';
import { extractChapterFromRoot, hrefOf, textOf } from './base';
import type { ParsedChapter } from '../../shared/types';

export const RoyalRoadParser: SiteParser = {
  id: 'royalroad',
  canHandle(url) {
    return /royalroad\.com\/fiction\/\d+\/chapter\//.test(url);
  },

  extract(options): ParsedChapter | null {
    const contentEl = document.querySelector('.chapter-content');
    if (!contentEl) return null;

    const title =
      textOf('.fic-header h1') ??
      textOf('.chapter-title') ??
      textOf('h1') ??
      document.title;

    return extractChapterFromRoot(contentEl, {
      title,
      site: 'royalroad',
      prevChapterUrl: hrefOf('a[href*="chapter"][rel="prev"], .btn-prev, a.prevChapter'),
      nextChapterUrl: hrefOf('a[href*="chapter"][rel="next"], .btn-next, a.nextChapter'),
    }, options);
  },
};
