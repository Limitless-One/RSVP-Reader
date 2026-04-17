import type { Chunk } from '../../shared/types';

export function speechRateLabel(rate: number): string {
  return `${rate.toFixed(1)}×`;
}

export function speechTextForChunk(chunk: Chunk): string {
  return chunk.displayText.replace(/\s+/g, ' ').trim();
}

export function effectiveSpeechRate(baseRate: number, wpm: number): number {
  const scaled = baseRate * (wpm / 240);
  return Math.max(0.6, Math.min(3, Number(scaled.toFixed(2))));
}

/**
 * Collects the display text of every chunk in the buffer into a single sentence
 * string suitable for neural TTS synthesis (fire-and-forget, full sentence).
 */
export function speechTextForSentence(buffer: Chunk[]): string {
  return buffer
    .map(c => c.displayText.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates the TTS playback speed so the sentence audio roughly occupies the
 * same wall-clock time as reading those words at the current RSVP WPM.
 *
 * NATURAL_TTS_WPM is the model's approximate speaking rate at speed = 1.0
 * (after speed priors are applied). Tune this if audio feels too fast/slow.
 */
const NATURAL_TTS_WPM = 130;

export function neuralSpeechRate(wordCount: number, wpm: number, baseRate: number): number {
  if (wordCount <= 0 || wpm <= 0) return baseRate;
  const raw = baseRate * (wpm / NATURAL_TTS_WPM);
  return Math.max(0.5, Math.min(4.0, Number(raw.toFixed(2))));
}
