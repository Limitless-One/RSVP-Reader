import type { SiteParser } from './base';
import { extractChapterFromRoot, hrefOf, textOf } from './base';
import type { ParsedChapter } from '../../shared/types';

export const WattpadParser: SiteParser = {
  id: 'wattpad',
  canHandle(url) {
    return /wattpad\.com\//.test(url);
  },
  extract(options): ParsedChapter | null {
    const contentEl = document.querySelector('.part-content pre, .story-parts pre, [data-page-number]');
    if (!contentEl) return null;
    const title = textOf('.part-title, h2') ?? document.title;
    return extractChapterFromRoot(contentEl, {
      title, site: 'wattpad',
      prevChapterUrl: hrefOf('a[data-track="prev_part"]'),
      nextChapterUrl: hrefOf('a[data-track="next_part"]'),
    }, options);
  },
};

export const AO3Parser: SiteParser = {
  id: 'ao3',
  canHandle(url) {
    return /archiveofourown\.org\/works\//.test(url);
  },
  extract(options): ParsedChapter | null {
    const contentEl = document.querySelector('#chapters .userstuff, .userstuff');
    if (!contentEl) return null;
    const title =
      textOf('#chapters .title') ??
      textOf('h2.title') ??
      textOf('h3.title') ??
      document.title;
    return extractChapterFromRoot(contentEl, {
      title, site: 'ao3',
      prevChapterUrl: hrefOf('[rel="prev"]'),
      nextChapterUrl: hrefOf('[rel="next"]'),
    }, options);
  },
};

export const FanFictionParser: SiteParser = {
  id: 'fanfiction',
  canHandle(url) {
    return /fanfiction\.net\/s\//.test(url);
  },
  extract(options): ParsedChapter | null {
    const contentEl = document.querySelector('#storytext');
    if (!contentEl) return null;
    const title = textOf('#chap_select option[selected]') ?? document.title;
    return extractChapterFromRoot(contentEl, {
      title, site: 'fanfiction',
      prevChapterUrl: hrefOf('button[onclick*="self.location"][value*="prev"], a:has(button[value*="prev"])'),
      nextChapterUrl: hrefOf('button[onclick*="self.location"][value*="next"], a:has(button[value*="next"])'),
    }, options);
  },
};

/** SpaceBattles and SufficientVelocity (XenForo) */
export const XenForoParser: SiteParser = {
  id: 'xenforo',
  canHandle(url) {
    return /sufficientvelocity\.com\/threads\/|spacebattles\.com\/threads\//.test(url);
  },
  extract(options): ParsedChapter | null {
    // On threadmarks/posts, grab the first post's content
    const posts = Array.from(document.querySelectorAll('article.message-body, .bbWrapper'));
    if (posts.length === 0) return null;
    const contentEl = posts[0];
    const title = textOf('h1.p-title-value') ?? document.title;
    return extractChapterFromRoot(contentEl, {
      title, site: 'xenforo',
      prevChapterUrl: hrefOf('.pageNav-jump--prev'),
      nextChapterUrl: hrefOf('.pageNav-jump--next'),
    }, options);
  },
};
