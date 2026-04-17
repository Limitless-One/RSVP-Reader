import { NovelBinParser, RanobesParser, WordPressParser, WtrLabParser } from '../../src/content/parsers/additional';

function longParagraph(text: string): string {
  return `${text} ${text} ${text} ${text}`;
}

describe('additional parsers', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('extracts WordPress article content from common entry-content roots', () => {
    document.head.innerHTML = '<meta name="generator" content="WordPress 6.9">';
    document.body.className = 'single postid-1 wp-singular';
    document.body.innerHTML = `
      <article>
        <h1 class="entry-title">Chapter 12</h1>
        <div class="entry-content">
          <p>${longParagraph('A calm paragraph sits here.')}</p>
          <p>${longParagraph('Another paragraph follows the first one.')}</p>
        </div>
      </article>
    `;

    expect(WordPressParser.canHandle('https://practicalguidetoevil.wordpress.com/2015/11/11/chapter-1-supply/')).toBe(true);
    const chapter = WordPressParser.extract({ includeAuthorNotes: false });

    expect(chapter?.site).toBe('wordpress');
    expect(chapter?.title).toBe('Chapter 12');
    expect(chapter?.blocks).toHaveLength(2);
  });

  it('prefers the main WordPress post body over smaller sidebar-style entry content', () => {
    document.head.innerHTML = '<meta name="generator" content="WordPress 6.9">';
    document.body.className = 'single postid-26 wp-singular';
    document.body.innerHTML = `
      <aside>
        <div class="entry-content">
          <p>Short widget text.</p>
        </div>
      </aside>
      <main id="main">
        <article class="post type-post">
          <h1 class="entry-title">Sting 26.6</h1>
          <div class="entry-content">
            <p>${longParagraph('The real chapter body should win even if a smaller entry-content appears earlier in the DOM.')}</p>
            <p>${longParagraph('A second paragraph keeps the post body comfortably above the extraction threshold.')}</p>
          </div>
        </article>
      </main>
    `;

    expect(WordPressParser.canHandle('https://parahumans.wordpress.com/2013/08/03/sting-26-6/')).toBe(true);
    const chapter = WordPressParser.extract({ includeAuthorNotes: false });

    expect(chapter?.title).toBe('Sting 26.6');
    expect(chapter?.text).toContain('real chapter body should win');
    expect(chapter?.text).not.toContain('Short widget text');
  });

  it('extracts NovelBin chapters from the chapter content root', () => {
    document.body.innerHTML = `
      <h1 class="chapter-title">NovelBin Chapter</h1>
      <div id="chr-content">
        <p>${longParagraph('The first novelbin paragraph has enough text to parse cleanly.')}</p>
        <p>${longParagraph('The second paragraph continues the chapter in the same container.')}</p>
      </div>
      <div class="chr-nav">
        <a class="prev" href="https://novelbin.org/book/example/chapter-2" title="Prev Chapter">Prev</a>
        <a class="next" href="https://novelbin.org/book/example/chapter-4" title="Next Chapter">Next</a>
      </div>
    `;

    expect(NovelBinParser.canHandle('https://novelbin.org/book/example/chapter-3')).toBe(true);
    const chapter = NovelBinParser.extract({ includeAuthorNotes: false });

    expect(chapter?.site).toBe('novelbin');
    expect(chapter?.prevChapterUrl).toContain('/chapter-2');
    expect(chapter?.nextChapterUrl).toContain('/chapter-4');
    expect(chapter?.blocks).toHaveLength(2);
  });

  it('extracts Ranobes chapters from the fulltext container', () => {
    document.body.innerHTML = `
      <div class="reader-header">
        <h1>Ranobes Chapter</h1>
        <a class="prev" href="https://ranobes.my/novels/example/chapters/17" title="Previous chapter">Prev</a>
        <a class="next" href="https://ranobes.my/novels/example/chapters/19" title="Next chapter">Next</a>
      </div>
      <div class="r-fulltext">
        <p>${longParagraph('Ranobes content should be captured from this fulltext area.')}</p>
        <p>${longParagraph('A second paragraph confirms multi-block extraction still works.')}</p>
      </div>
    `;

    expect(RanobesParser.canHandle('https://ranobes.my/novels/example/chapters/18')).toBe(true);
    const chapter = RanobesParser.extract({ includeAuthorNotes: false });

    expect(chapter?.site).toBe('ranobes');
    expect(chapter?.title).toBe('Ranobes Chapter');
    expect(chapter?.blocks).toHaveLength(2);
  });

  it('extracts Ranobes chapters from the .top domain too', () => {
    document.body.innerHTML = `
      <div class="reader-header">
        <h1>Ranobes Top Chapter</h1>
        <a class="prev" href="https://ranobes.top/novels/example/chapters/17" title="Previous chapter">Prev</a>
        <a class="next" href="https://ranobes.top/novels/example/chapters/19" title="Next chapter">Next</a>
      </div>
      <div class="r-fulltext">
        <p>${longParagraph('Ranobes top-domain content should use the same family of selectors as Ranobes.')}</p>
        <p>${longParagraph('This keeps extraction stable across the two related sites.')}</p>
      </div>
    `;

    expect(RanobesParser.canHandle('https://ranobes.top/novels/example/chapters/18')).toBe(true);
    const chapter = RanobesParser.extract({ includeAuthorNotes: false });

    expect(chapter?.site).toBe('ranobes');
    expect(chapter?.title).toBe('Ranobes Top Chapter');
    expect(chapter?.blocks).toHaveLength(2);
  });

  it('recognizes Ranobes on the .com domain', () => {
    expect(RanobesParser.canHandle('https://ranobes.com/novels/example/chapters/18')).toBe(true);
  });

  it('extracts WTR-LAB chapters and normalizes navigation to webplus', () => {
    document.body.innerHTML = `
      <main>
        <article>
          <h1>WTR Chapter</h1>
          <div class="reading-content">
            <p>${longParagraph('WTR-LAB chapters should be readable from the visible reading content.')}</p>
            <p>${longParagraph('The parser should also push chapter navigation toward webplus mode.')}</p>
          </div>
        </article>
      </main>
      <div class="chapter-nav">
        <a class="prev" href="https://wtr-lab.com/en/novel/1/chapter/2">Prev</a>
        <a class="next" href="https://wtr-lab.com/en/novel/1/chapter/4">Next</a>
      </div>
    `;

    expect(WtrLabParser.canHandle('https://wtr-lab.com/en/novel/1/chapter/3')).toBe(true);
    const chapter = WtrLabParser.extract({ includeAuthorNotes: false });

    expect(chapter?.site).toBe('wtrlab');
    expect(chapter?.nextChapterUrl).toContain('service=webplus');
    expect(chapter?.blocks).toHaveLength(2);
  });
});
