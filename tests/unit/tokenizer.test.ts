import { buildChunks } from '../../src/content/rsvp/tokenizer';

const singleBlock = (text: string) => [
  { id: 'block-1', text, startOffset: 0, endOffset: text.length },
];

describe('buildChunks', () => {
  it('preserves punctuation in displayed chunks', () => {
    const text = 'Hello, world!';
    const chunks = buildChunks(text, singleBlock(text), 1, false);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.displayText).toBe('Hello,');
    expect(chunks[1]?.displayText).toBe('world!');
  });

  it('snaps to sentence boundaries in sentence mode', () => {
    const text = 'Hello world. Next bit.';
    const chunks = buildChunks(text, singleBlock(text), 1, true);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.displayText).toBe('Hello world.');
    expect(chunks[1]?.displayText).toBe('Next bit.');
  });

  it('preserves non-English scripts in display text', () => {
    const text = 'Привет, мир! こんにちは 世界';
    const chunks = buildChunks(text, singleBlock(text), 1, false);

    expect(chunks[0]?.displayText).toBe('Привет,');
    expect(chunks[1]?.displayText).toBe('мир!');
    expect(chunks[2]?.displayText).toBe('こんにちは');
  });

  it('can group words into phrase-based chunks', () => {
    const text = 'He walked to the store and bought milk for dinner.';
    const chunks = buildChunks(text, singleBlock(text), 1, false, 'phrase', 'balanced');

    expect(chunks.map(chunk => chunk.displayText)).toEqual([
      'He walked to',
      'the store',
      'and bought milk',
      'for dinner.',
    ]);
  });

  it('closes immediately at sentence endings in adaptive chunking', () => {
    const text = 'Wait. This next sentence should not leak backwards.';
    const chunks = buildChunks(text, singleBlock(text), 3, false, 'phrase', 'balanced', true);

    expect(chunks[0]?.displayText).toBe('Wait.');
    expect(chunks[1]?.displayText.startsWith('This')).toBe(true);
  });

  it('can keep chunk size exact when adaptive chunk sizing is disabled', () => {
    const text = 'One two three four five';
    const chunks = buildChunks(text, singleBlock(text), 2, false, 'phrase', 'balanced', false);

    expect(chunks.map(chunk => chunk.displayText)).toEqual([
      'One two',
      'three four',
      'five',
    ]);
  });

  it('marks dialogue and technical chunks for downstream rendering', () => {
    const text = '"Run now," she said. Install foo_bar 20 first.';
    const chunks = buildChunks(text, singleBlock(text), 1, false, 'phrase', 'technical');

    expect(chunks[0]?.isDialogue).toBe(true);
    expect(chunks.some(chunk => chunk.containsNumber)).toBe(true);
    expect(chunks.some(chunk => chunk.isCodeLike)).toBe(true);
  });
});
