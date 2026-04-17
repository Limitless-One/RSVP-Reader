import { createLocalTextChapter, fileNameFromUrl, isLocalTextFileUrl } from '../../shared/local-text';
import type { ParsedChapter } from '../../shared/types';
import type { SiteParser } from './base';

export const LocalFileParser: SiteParser = {
  id: 'generic',
  canHandle(url: string): boolean {
    return isLocalTextFileUrl(url);
  },

  extract(): ParsedChapter | null {
    const plainTextRoot = document.querySelector('body > pre');
    const rawText = (plainTextRoot?.textContent ?? document.body.innerText ?? document.body.textContent ?? '').trim();
    if (!rawText) return null;

    const sourceName = document.title.trim() || fileNameFromUrl(location.href);
    const chapter = createLocalTextChapter(sourceName, rawText);
    return chapter.text ? chapter : null;
  },
};
