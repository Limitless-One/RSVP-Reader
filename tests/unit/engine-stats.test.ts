import { DEFAULT_SETTINGS } from '../../src/shared/constants';
import { RSVPEngine } from '../../src/content/rsvp/engine';

const singleBlock = (text: string) => [
  { id: 'block-1', text, startOffset: 0, endOffset: text.length },
];

describe('RSVPEngine session stats', () => {
  it('tracks words read relative to the session start word, not chapter start', () => {
    const engine = new RSVPEngine({
      ...DEFAULT_SETTINGS,
      adaptiveChunkSizing: false,
      segmentationMode: 'fixed',
    });

    engine.load('One two three four five six', singleBlock('One two three four five six'), 3);
    engine.play();
    engine.forward();
    engine.pause();

    expect(engine.getSessionStats().wordsRead).toBe(2);
  });
});
