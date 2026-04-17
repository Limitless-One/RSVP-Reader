import { effectiveSpeechRate, speechTextForChunk } from '../../src/content/rsvp/read-aloud';
import type { Chunk } from '../../src/shared/types';

function makeChunk(displayText: string, options: Partial<Chunk> = {}): Chunk {
  const wordCount = options.wordCount ?? displayText.split(/\s+/).filter(Boolean).length;
  return {
    tokens: options.tokens ?? [],
    rawText: options.rawText ?? displayText,
    displayText,
    index: options.index ?? 0,
    isSentenceEnd: options.isSentenceEnd ?? false,
    startOffset: options.startOffset ?? 0,
    endOffset: options.endOffset ?? displayText.length,
    wordStartIndex: options.wordStartIndex ?? 0,
    wordEndIndex: options.wordEndIndex ?? wordCount,
    wordCount,
    blockIds: options.blockIds ?? [],
    isDialogue: options.isDialogue ?? false,
    containsNumber: options.containsNumber ?? false,
    isCodeLike: options.isCodeLike ?? false,
  };
}

describe('read aloud helpers', () => {
  it('uses the current displayed chunk as speech text', () => {
    const chunk = makeChunk('Hello there, traveler.');
    expect(speechTextForChunk(chunk)).toBe('Hello there, traveler.');
  });

  it('normalizes extra whitespace in speech text', () => {
    const chunk = makeChunk('  through   the valley  ');
    expect(speechTextForChunk(chunk)).toBe('through the valley');
  });

  it('scales speech rate with wpm within a safe range', () => {
    expect(effectiveSpeechRate(1, 240)).toBe(1);
    expect(effectiveSpeechRate(1, 480)).toBe(2);
    expect(effectiveSpeechRate(1, 60)).toBe(0.6);
  });
});
