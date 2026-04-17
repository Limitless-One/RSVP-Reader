import { PACING, WARMUP_DURATION_MS, WARMUP_START_RATIO } from '../../shared/constants';
import type { Chunk, SegmentationMode, Settings } from '../../shared/types';

// ─── Interval calculator ──────────────────────────────────────────────────────

/**
 * Convert WPM to the base millisecond interval for a chunk of `chunkSize` words.
 * e.g. 300 WPM, 1 word/chunk → 200 ms/chunk
 */
export function wpmToInterval(wpm: number, chunkSize: number): number {
  return (60_000 / wpm) * chunkSize;
}

/**
 * Returns the actual display duration in ms for a chunk, applying
 * rule-based pacing multipliers when `adaptive` is true.
 * Pass `pauses` from Settings to use user-configured multipliers;
 * omit it to use the built-in PACING constants.
 */
export function chunkDelay(
  chunk: Chunk,
  baseIntervalMs: number,
  settings: Pick<Settings, 'adaptivePacing' | 'punctuationPauses' | 'readingMode'>,
): number {
  let delay = baseIntervalMs;

  if (settings.adaptivePacing) {
    const tokens = chunk.tokens;
    const wordTokens = tokens.filter(t => t.type === 'word' || t.type === 'number');
    if (wordTokens.length === 0) return baseIntervalMs;

    const lastTok = tokens[tokens.length - 1];
    let punctMult = 1.0;
    switch (lastTok.punctuationAfter) {
      case 'sentence':  punctMult = settings.punctuationPauses.sentenceEnd ?? PACING.SENTENCE_END; break;
      case 'ellipsis':  punctMult = settings.punctuationPauses.ellipsis    ?? PACING.ELLIPSIS;     break;
      case 'dash':      punctMult = settings.punctuationPauses.dash        ?? PACING.DASH;         break;
      case 'clause':    punctMult = settings.punctuationPauses.clause      ?? PACING.CLAUSE;       break;
    }

    let wordMult = 1.0;
    const stopRatio = wordTokens.filter(t => t.isStopWord).length / wordTokens.length;
    const hasProper = wordTokens.some(t => t.isProperNoun);
    const longestWord = wordTokens.reduce((max, token) => Math.max(max, token.charCount), 0);
    const shortestWord = wordTokens.reduce((min, token) => Math.min(min, token.charCount), Infinity);

    if (stopRatio >= PACING.STOP_WORD_RATIO_THRESHOLD)
      wordMult *= PACING.STOP_WORD_SPEED;

    if (chunk.containsNumber) wordMult *= PACING.NUMBER;
    if (hasProper) wordMult *= PACING.PROPER_NOUN;

    if (longestWord > PACING.LONG_WORD_BASE)
      wordMult *= 1.0 + (longestWord - PACING.LONG_WORD_BASE) * PACING.LONG_WORD_PER_CHAR;
    else if (shortestWord <= PACING.SHORT_WORD_THRESHOLD)
      wordMult *= PACING.SHORT_WORD_SPEED;

    if (settings.readingMode === 'story') {
      punctMult = 1 + (punctMult - 1) * 0.78;
    } else if (settings.readingMode === 'dialogue' && chunk.isDialogue) {
      punctMult = 1 + (punctMult - 1) * 0.7;
    }

    const combined = punctMult > 1.0
      ? punctMult * Math.max(1.0, wordMult)
      : punctMult * wordMult;
    delay = baseIntervalMs * combined;
  }

  delay *= readingModeMultiplier(chunk, settings.readingMode);

  return Math.max(40, Math.min(baseIntervalMs * 3, delay));
}

// ─── Warmup ramp ─────────────────────────────────────────────────────────────

/**
 * Returns a playback speed ratio (≤ 1) for the opening seconds of active reading.
 * Linearly ramps from WARMUP_START_RATIO → 1.0 across WARMUP_DURATION_MS.
 */
export function warmupMultiplier(activeElapsedMs: number, enabled: boolean): number {
  if (!enabled || activeElapsedMs >= WARMUP_DURATION_MS) return 1.0;
  const t = activeElapsedMs / WARMUP_DURATION_MS;
  return WARMUP_START_RATIO + t * (1.0 - WARMUP_START_RATIO);
}

// ─── Estimated reading time remaining ────────────────────────────────────────

/** Returns a human-readable string like "~3 min remaining" */
export function estimateRemaining(
  wordsLeft: number,
  wpm: number,
): string {
  const minutesLeft = wordsLeft / wpm;

  if (minutesLeft < 1) return '< 1 min left';
  if (minutesLeft < 60) return `~${Math.ceil(minutesLeft)} min left`;
  const h = Math.floor(minutesLeft / 60);
  const m = Math.round(minutesLeft % 60);
  return `~${h}h ${m}m left`;
}

export function playbackModeLabel(
  segmentationMode: SegmentationMode,
): string {
  switch (segmentationMode) {
    case 'phrase':
      return 'phrase chunks';
    case 'clause':
      return 'clause chunks';
    case 'meaning':
      return 'meaning units';
    default:
      return 'fixed chunks';
  }
}

export function intervalLabel(
  wpm: number,
  chunkSize: number,
  segmentationMode: SegmentationMode = 'fixed',
  adaptiveChunkSizing = segmentationMode !== 'fixed',
): string {
  const effectiveSegmentationMode = adaptiveChunkSizing && segmentationMode === 'fixed'
    ? 'phrase'
    : segmentationMode;
  if (adaptiveChunkSizing && effectiveSegmentationMode !== 'fixed') {
    return playbackModeLabel(effectiveSegmentationMode);
  }
  const intervalMs = Math.round(wpmToInterval(wpm, chunkSize));
  return `${intervalMs} ms/chunk`;
}

function readingModeMultiplier(
  chunk: Chunk,
  readingMode: Settings['readingMode'],
): number {
  switch (readingMode) {
    case 'dialogue':
      return chunk.isDialogue ? 0.88 : 0.96;
    case 'technical': {
      let multiplier = 1.08;
      if (chunk.containsNumber) multiplier *= 1.12;
      if (chunk.isCodeLike) multiplier *= 1.14;
      return multiplier;
    }
    case 'story':
      return chunk.isDialogue ? 0.95 : 1.02;
    default:
      return 1;
  }
}
