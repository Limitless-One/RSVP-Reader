import type { SiteParser } from './base';
import { cleanText, extractChapterFromRoot, hrefOf, textOf } from './base';
import type { ParserOptions } from './base';
import type { ParsedChapter } from '../../shared/types';

const NOVELBIN_ROOTS = [
  '#chr-content',
  '.chr-c',
  '.chr-text',
  '.chapter-body',
  '.chapter-content',
  '.reading-content',
];

const RANOBES_ROOTS = [
  '.r-fulltext',
  '.chapter-content',
  '.content-inner',
  '.reader-container',
  '.text-left .content',
  '.reading-content',
];

function firstMatch(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (node) return node;
  }
  return null;
}

export const WordPressParser: SiteParser = {
  id: 'wordpress',
  canHandle(url) {
    const matchesWordPressChapterUrl = /:\/\/[^/]+\.wordpress\.com\/\d{4}\/\d{2}\/\d{2}\/[^/?#]+\/?$/i.test(url);
    const hasWordPressMeta = Boolean(
      document.querySelector('meta[name="generator"][content*="WordPress" i]'),
    );
    const hasWordPressBody = Boolean(
      document.querySelector('body.wp-singular, body.single, body.blog, body[class*="wp-"]'),
    );
    const hasWordPressRoot = Boolean(
      document.querySelector('.wp-block-post-content, article .entry-content, .single-post .entry-content'),
    );
    return Boolean(
      matchesWordPressChapterUrl ||
      hasWordPressMeta ||
      hasWordPressBody ||
      hasWordPressRoot,
    );
  },

  extract(options): ParsedChapter | null {
    const contentEl = resolveWordPressContent(options);
    if (!contentEl) return null;

    const title =
      textOf('article h1.entry-title') ??
      textOf('.entry-title') ??
      textOf('.post-title') ??
      textOf('h1') ??
      document.title;

    return extractChapterFromRoot(contentEl, {
      title,
      site: 'wordpress',
      prevChapterUrl: wordPressNavHref(/previous|prev/i, 'a[rel="prev"], .nav-previous a, .post-navigation .nav-previous a'),
      nextChapterUrl: wordPressNavHref(/next/i, 'a[rel="next"], .nav-next a, .post-navigation .nav-next a'),
    }, options);
  },
};

export const NovelBinParser: SiteParser = {
  id: 'novelbin',
  canHandle(url) {
    return /(^|\.)novelbin\.(com|org|cc)(\/|$)/i.test(new URL(url).hostname);
  },

  extract(options): ParsedChapter | null {
    const contentEl = firstMatch(NOVELBIN_ROOTS);
    if (!contentEl) return null;

    const title =
      textOf('.chr-title') ??
      textOf('.chapter-title') ??
      textOf('.novel-title') ??
      textOf('h1') ??
      document.title;

    return extractChapterFromRoot(contentEl, {
      title,
      site: 'novelbin',
      prevChapterUrl: hrefOf(
        'a[rel="prev"], .chr-nav a[href*="chapter"][title*="prev" i], .chr-nav a.prev, .chapter-nav a.prev',
      ),
      nextChapterUrl: hrefOf(
        'a[rel="next"], .chr-nav a[href*="chapter"][title*="next" i], .chr-nav a.next, .chapter-nav a.next',
      ),
    }, options);
  },
};

export const RanobesParser: SiteParser = {
  id: 'ranobes',
  canHandle(url) {
    return /(^|\.)ranobes\.(my|world|top|com)(\/|$)/i.test(new URL(url).hostname);
  },

  extract(options): ParsedChapter | null {
    const contentEl = firstMatch(RANOBES_ROOTS);
    if (!contentEl) return null;

    const title =
      textOf('.chapter__title') ??
      textOf('.reader-header h1') ??
      textOf('.title_top') ??
      textOf('h1') ??
      document.title;

    return extractChapterFromRoot(contentEl, {
      title,
      site: 'ranobes',
      prevChapterUrl: hrefOf(
        'a[rel="prev"], .chapter-nav a[href*="chapter"][title*="prev" i], .reader-header a.prev, .pager a.prev',
      ),
      nextChapterUrl: hrefOf(
        'a[rel="next"], .chapter-nav a[href*="chapter"][title*="next" i], .reader-header a.next, .pager a.next',
      ),
    }, options);
  },
};

function resolveWordPressContent(options: ParserOptions = { includeAuthorNotes: false }): Element | null {
  const candidates = [
    ...collectWordPressCandidates([
      'article .entry-content',
      'article .wp-block-post-content',
      'article .entry-inner',
      'article .entrytext',
      'article .post-content',
      'article .post-body',
      'article .storycontent',
      '.single-post .entry-content',
      '.single .entry-content',
      '.entry-content',
      '.wp-block-post-content',
      '.entry-inner',
      '.entrytext',
      '.post-content',
      '.post-body',
      '.storycontent',
    ], 4_000),
    ...collectWordPressCandidates([
      '#content article',
      '#primary article',
      '#main article',
      'main article',
      'article.post',
      'article.type-post',
      'article',
      '.post',
    ], 1_000),
  ];

  const best = candidates
    .map(el => ({ el, score: scoreWordPressCandidate(el, options) }))
    .filter(entry => entry.score >= 200)
    .sort((a, b) => b.score - a.score)[0];

  return best?.el ?? null;
}

function wordPressNavHref(textPattern: RegExp, selectorFallback: string): string | null {
  const textMatch = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
    .find(anchor => {
      const text = (anchor.textContent ?? '').trim();
      return textPattern.test(text) && anchor.href;
    });

  return textMatch?.href ?? hrefOf(selectorFallback);
}

function collectWordPressCandidates(selectors: string[], bonus: number): Array<Element & { __rsvpScoreBonus?: number }> {
  const seen = new Set<Element>();
  const candidates: Array<Element & { __rsvpScoreBonus?: number }> = [];

  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(node => {
      if (seen.has(node) || !isWordPressContentCandidate(node)) return;
      seen.add(node);
      const candidate = node as Element & { __rsvpScoreBonus?: number };
      candidate.__rsvpScoreBonus = Math.max(candidate.__rsvpScoreBonus ?? 0, bonus);
      candidates.push(candidate);
    });
  });

  return candidates;
}

function isWordPressContentCandidate(node: Element): boolean {
  return !node.closest(
    '#comments, .comments-area, .comment-respond, .sharedaddy, .jp-relatedposts, .widget, aside, footer, nav',
  );
}

function scoreWordPressCandidate(
  node: Element & { __rsvpScoreBonus?: number },
  options: ParserOptions,
): number {
  const textLength = cleanText(node, options).length;
  if (textLength < 120) return 0;

  const paragraphCount = node.querySelectorAll('p').length;
  const headingCount = node.querySelectorAll('h1, h2, h3').length;
  const bonus = node.__rsvpScoreBonus ?? 0;

  return bonus + textLength + paragraphCount * 180 + headingCount * 40;
}

const WTRLAB_ROOTS = [
  '[data-testid="chapter-content"]',
  '.chapter-content',
  '.chapter-body',
  '.reading-content',
  '.reader-content',
  '.prose',
  'article',
  'main article',
  'main .content',
];

function withWtrLabPreferredView(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, location.href);
    if (
      parsed.hostname === 'wtr-lab.com' ||
      parsed.hostname === 'www.wtr-lab.com' ||
      parsed.hostname === 'echo.wtr-lab.com'
    ) {
      parsed.searchParams.set('service', 'webplus');
    }
    return parsed.href;
  } catch {
    return url;
  }
}

export const WtrLabParser: SiteParser = {
  id: 'wtrlab',
  canHandle(url) {
    return /(^|\.)(www\.|echo\.)?wtr-lab\.com(\/|$)/i.test(new URL(url).hostname);
  },

  extract(options): ParsedChapter | null {
    const contentEl = firstMatch(WTRLAB_ROOTS);
    if (!contentEl) return null;

    const title =
      textOf('[data-testid="chapter-title"]') ??
      textOf('.chapter-title') ??
      textOf('article h1') ??
      textOf('main h1') ??
      textOf('h1') ??
      document.title;

    return extractChapterFromRoot(contentEl, {
      title,
      site: 'wtrlab',
      prevChapterUrl: withWtrLabPreferredView(
        hrefOf('a[rel="prev"], a[href*="/chapter/"][aria-label*="prev" i], .chapter-nav a.prev, .pager a.prev'),
      ),
      nextChapterUrl: withWtrLabPreferredView(
        hrefOf('a[rel="next"], a[href*="/chapter/"][aria-label*="next" i], .chapter-nav a.next, .pager a.next'),
      ),
    }, options);
  },
};
