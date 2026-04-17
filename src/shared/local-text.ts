import type { ParsedBlock, ParsedChapter } from './types';

const LOCAL_TEXT_SITE = 'Local file';

export function createLocalTextChapter(sourceName: string, rawText: string): ParsedChapter {
  const paragraphs = normalizeParagraphs(rawText);
  const blocks: ParsedBlock[] = [];
  let cursor = 0;

  paragraphs.forEach((paragraph, index) => {
    const startOffset = cursor;
    const endOffset = startOffset + paragraph.length;
    blocks.push({
      id: `local-block-${index + 1}`,
      text: paragraph,
      startOffset,
      endOffset,
    });
    cursor = endOffset + 2;
  });

  return {
    title: titleFromFileName(sourceName),
    text: paragraphs.join('\n\n'),
    site: LOCAL_TEXT_SITE,
    prevChapterUrl: null,
    nextChapterUrl: null,
    blocks,
  };
}

export function titleFromFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const withoutTxt = trimmed.replace(/\.txt$/i, '');
  return withoutTxt || trimmed || 'Untitled text';
}

export function fileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const fileName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '');
    return fileName || 'Untitled text';
  } catch {
    return 'Untitled text';
  }
}

export function normalizeLocalText(rawText: string): string {
  return normalizeParagraphs(rawText).join('\n\n');
}

export function isLocalTextFileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'file:' && /\.txt$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function normalizeParagraphs(rawText: string): string[] {
  return rawText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map(paragraph => paragraph
      .replace(/[ \t]*\n[ \t]*/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim())
    .filter(Boolean);
}
