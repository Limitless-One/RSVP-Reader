import { LocalFileParser } from '../../src/content/parsers/local-file';
function longParagraph(text: string): string {
  return `${text} ${text} ${text} ${text}`;
}

describe('local file parser', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.title = '';
  });

  it('recognizes .txt file urls', () => {
    expect(LocalFileParser.canHandle('file:///Users/harsha/Documents/chapter-01.txt')).toBe(true);
    expect(LocalFileParser.canHandle('file:///Users/harsha/Documents/chapter-01.html')).toBe(false);
  });

  it('extracts plain text file pages from the rendered body text', () => {
    document.title = 'chapter-01.txt';
    document.body.innerHTML = `<pre>${longParagraph('The browser-rendered text file should be readable like a chapter.')}\n\n${longParagraph('A second paragraph keeps the semantic chunker fed with enough prose.')}</pre>`;

    const chapter = LocalFileParser.extract();

    expect(chapter?.title).toBe('chapter-01');
    expect(chapter?.site).toBe('Local file');
    expect(chapter?.blocks).toHaveLength(2);
    expect(chapter?.text).toContain('browser-rendered text file');
  });
});
