import { DEFAULT_SETTINGS } from '../../src/shared/constants';
import { RSVPEngine } from '../../src/content/rsvp/engine';

const singleBlock = (text: string) => [
  { id: 'block-1', text, startOffset: 0, endOffset: text.length },
];
const fixedSettings = {
  ...DEFAULT_SETTINGS,
  adaptiveChunkSizing: false,
  segmentationMode: 'fixed' as const,
};

describe('RSVPEngine navigation', () => {
  it('goes to the previous displayed chunk instead of replaying the current one', () => {
    const engine = new RSVPEngine(fixedSettings);
    const seen: string[] = [];

    engine.on(event => {
      if (event.type === 'chunk') {
        seen.push(event.chunk.displayText);
      }
    });

    engine.load('One two three four', singleBlock('One two three four'), 0);
    engine.play();
    engine.forward();
    expect(seen.at(-1)).toBe('two');

    engine.back();
    expect(seen.at(-1)).toBe('One');
    engine.pause();
  });

  it('uses forward to show the next chunk without skipping ahead', () => {
    const engine = new RSVPEngine(fixedSettings);
    const seen: string[] = [];

    engine.on(event => {
      if (event.type === 'chunk') {
        seen.push(event.chunk.displayText);
      }
    });

    engine.load('One two three four', singleBlock('One two three four'), 0);
    engine.play();
    engine.forward();
    engine.forward();

    expect(seen).toContain('two');
    expect(seen.at(-1)).toBe('three');
    engine.pause();
  });
});
