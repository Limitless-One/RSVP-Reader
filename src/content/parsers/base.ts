import type { ParsedBlock, ParsedChapter, SiteId } from '../../shared/types';

export interface SiteParser {
  id: SiteId;
  /** Returns true if this parser handles the current page */
  canHandle(url: string): boolean;
  /** Extract chapter text and metadata from the current DOM */
  extract(options?: ParserOptions): ParsedChapter | null;
}

export interface ParserOptions {
  includeAuthorNotes: boolean;
  enabledSites?: SiteId[];
  enabledSiteHosts?: string[];
}

interface ChapterFromRootOptions {
  title: string;
  site: string;
  prevChapterUrl: string | null;
  nextChapterUrl: string | null;
}

const JUNK_SELECTORS = [
  'script', 'style', 'nav', 'header', 'footer', 'aside',
  'figure', 'figcaption', 'iframe', 'noscript',
  '[class*="ad"]', '[class*="banner"]', '[id*="ad"]', '[id*="banner"]',
  '.portlet', '.hidden', '[aria-hidden="true"]',
];

const AUTHOR_NOTE_SELECTORS = [
  '[class*="author-note"]',
  '[class*="authornote"]',
  '[class*="authors-note"]',
  '[class*="author_note"]',
  '[class*="note-author"]',
  '[class*="a-n"]',
];

const BLOCK_SELECTOR = 'p, li, blockquote, pre, h1, h2, h3, h4, h5, h6';

// ─── Shared DOM helpers ───────────────────────────────────────────────────────

/** Return innerText of the first matching selector, or null */
export function textOf(selector: string, root: ParentNode = document): string | null {
  const el = root.querySelector(selector);
  if (!el) return null;
  const text = readText(el).trim();
  return text || null;
}

/** Href of the first matching anchor, resolved to absolute URL */
export function hrefOf(selector: string, root: ParentNode = document): string | null {
  const el = root.querySelector<HTMLAnchorElement>(selector);
  if (!el) return null;
  try {
    return new URL(el.href, location.href).href;
  } catch {
    return null;
  }
}

/**
 * Strips navigation junk from an element and returns clean prose text.
 * Removes: script, style, nav, header, footer, aside, figure,
 *          [class*=ad], [class*=banner], [id*=ad], [id*=banner]
 */
export function cleanText(el: Element, options: ParserOptions = { includeAuthorNotes: false }): string {
  const clone = el.cloneNode(true) as Element;

  const junk = [...JUNK_SELECTORS];
  if (!options.includeAuthorNotes) junk.push(...AUTHOR_NOTE_SELECTORS);

  junk.forEach(sel => {
    clone.querySelectorAll(sel).forEach(n => n.remove());
  });

  // Convert block elements to newlines before stripping HTML
  clone.querySelectorAll('p, br, div, li, h1, h2, h3, h4, h5, h6').forEach(node => {
    node.prepend('\n');
  });

  let text = readText(clone)
    .replace(/\r\n/g, '\n')
    .replace(/\u2018|\u2019/g, '\'')
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/-\n(?=\w)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!options.includeAuthorNotes) {
    text = text
      .replace(/\[?\s*author'?s?\s+note\s*[:\-][^\]]*\]?/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return text;
}

export function extractChapterFromRoot(
  root: Element,
  chapter: ChapterFromRootOptions,
  options: ParserOptions = { includeAuthorNotes: false },
): ParsedChapter | null {
  const blocks = extractBlocks(root, options);
  if (blocks.length === 0) return null;

  const text = blocks.map(block => block.text).join('\n\n').trim();
  if (text.length < 50) return null;

  return {
    ...chapter,
    text,
    blocks,
  };
}

export function extractBlocks(
  root: Element,
  options: ParserOptions = { includeAuthorNotes: false },
): ParsedBlock[] {
  root.querySelectorAll('[data-rsvp-block-id]').forEach(el => el.removeAttribute('data-rsvp-block-id'));

  let elements = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
    .filter(el => !hasAncestorMatching(el, BLOCK_SELECTOR))
    .filter(el => isUsableTextBlock(el, options));

  if (elements.length === 0) {
    elements = Array.from(root.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement)
      .filter(el => isUsableTextBlock(el, options));
  }

  if (elements.length === 0 && root instanceof HTMLElement && cleanText(root, options).length >= 50) {
    elements = [root];
  }

  const blocks: ParsedBlock[] = [];
  let offset = 0;
  elements.forEach((el, index) => {
    const text = cleanText(el, options);
    if (text.length < 20) return;

    const id = `rsvp-block-${index + 1}`;
    el.setAttribute('data-rsvp-block-id', id);
    const startOffset = offset;
    const endOffset = startOffset + text.length;
    blocks.push({ id, text, startOffset, endOffset });
    offset = endOffset + 2;
  });

  return blocks;
}

function hasAncestorMatching(el: Element, selector: string): boolean {
  let node = el.parentElement;
  while (node) {
    if (node.matches(selector)) return true;
    node = node.parentElement;
  }
  return false;
}

function isUsableTextBlock(el: HTMLElement, options: ParserOptions): boolean {
  if (JUNK_SELECTORS.some(sel => el.matches(sel))) return false;
  if (!options.includeAuthorNotes && AUTHOR_NOTE_SELECTORS.some(sel => el.matches(sel))) return false;
  const text = cleanText(el, options);
  return text.length >= 20;
}

function readText(el: Element): string {
  return (el as HTMLElement).innerText ?? el.textContent ?? '';
}
