import {
  createLocalTextChapter,
  fileNameFromUrl,
  isLocalTextFileUrl,
  normalizeLocalText,
  titleFromFileName,
} from '../../src/shared/local-text';

describe('local text helpers', () => {
  it('normalizes wrapped lines into clean paragraphs', () => {
    const rawText = '\uFEFFAlpha\nbeta\n\n\nGamma   delta\r\nline';

    expect(normalizeLocalText(rawText)).toBe('Alpha beta\n\nGamma delta line');
  });

  it('builds a parsed chapter with paragraph-aligned offsets', () => {
    const chapter = createLocalTextChapter('chapter-notes.txt', 'Alpha\nbeta\n\nGamma delta line');

    expect(chapter.title).toBe('chapter-notes');
    expect(chapter.site).toBe('Local file');
    expect(chapter.text).toBe('Alpha beta\n\nGamma delta line');
    expect(chapter.blocks).toEqual([
      { id: 'local-block-1', text: 'Alpha beta', startOffset: 0, endOffset: 10 },
      { id: 'local-block-2', text: 'Gamma delta line', startOffset: 12, endOffset: 28 },
    ]);
  });

  it('recognizes browser-opened local txt files', () => {
    expect(isLocalTextFileUrl('file:///Users/harsha/Downloads/test.txt')).toBe(true);
    expect(isLocalTextFileUrl('file:///Users/harsha/Downloads/test.md')).toBe(false);
  });

  it('falls back cleanly when a file name is empty', () => {
    expect(titleFromFileName('story.txt')).toBe('story');
    expect(titleFromFileName('')).toBe('Untitled text');
    expect(fileNameFromUrl('file:///Users/harsha/Chapter%2001.txt')).toBe('Chapter 01.txt');
  });
});
