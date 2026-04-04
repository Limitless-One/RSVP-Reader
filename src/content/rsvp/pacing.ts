import { PACING, WARMUP_DURATION_MS, WARMUP_START_RATIO } from '../../shared/constants';
import type { Chunk, PunctuationPauses } from '../../shared/types';

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
  adaptive: boolean,
  pauses?: PunctuationPauses,
): number {
  if (!adaptive) return baseIntervalMs;

  const tokens = chunk.tokens;
  const wordTokens = tokens.filter(t => t.type === 'word' || t.type === 'number');
  if (wordTokens.length === 0) return baseIntervalMs;

  // ── Punctuation multiplier (driven by the last token's pause type) ────────
  const lastTok = tokens[tokens.length - 1];
  let punctMult = 1.0;
  switch (lastTok.punctuationAfter) {
    case 'sentence':  punctMult = pauses?.sentenceEnd ?? PACING.SENTENCE_END; break;
    case 'ellipsis':  punctMult = pauses?.ellipsis     ?? PACING.ELLIPSIS;     break;
    case 'dash':      punctMult = pauses?.dash          ?? PACING.DASH;         break;
    case 'clause':    punctMult = pauses?.clause        ?? PACING.CLAUSE;       break;
  }

  // ── Word-composition multiplier ───────────────────────────────────────────
  let wordMult = 1.0;
  const stopRatio = wordTokens.filter(t => t.isStopWord).length / wordTokens.length;
  const hasNumber = wordTokens.some(t => t.type === 'number');
  const hasProper = wordTokens.some(t => t.isProperNoun);
  const longestWord = wordTokens.reduce((max, token) => Math.max(max, token.charCount), 0);
  const shortestWord = wordTokens.reduce((min, token) => Math.min(min, token.charCount), Infinity);

  if (stopRatio >= PACING.STOP_WORD_RATIO_THRESHOLD)
    wordMult *= PACING.STOP_WORD_SPEED;

  if (hasNumber) wordMult *= PACING.NUMBER;
  if (hasProper) wordMult *= PACING.PROPER_NOUN;

  if (longestWord > PACING.LONG_WORD_BASE)
    wordMult *= 1.0 + (longestWord - PACING.LONG_WORD_BASE) * PACING.LONG_WORD_PER_CHAR;
  else if (shortestWord <= PACING.SHORT_WORD_THRESHOLD)
    wordMult *= PACING.SHORT_WORD_SPEED;

  // Punctuation dominates; word composition is secondary
  const combined = punctMult > 1.0
    ? punctMult * Math.max(1.0, wordMult)   // don't let stop-word speedup cancel a pause
    : punctMult * wordMult;

  // Clamp to a sane range: 40 ms minimum, 3× base maximum
  return Math.max(40, Math.min(baseIntervalMs * 3, baseIntervalMs * combined));
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
  currentIdx: number,
  totalChunks: number,
  wpm: number,
  chunkSize: number,
): string {
  const chunksLeft = Math.max(0, totalChunks - currentIdx);
  const wordsLeft = chunksLeft * chunkSize;
  const minutesLeft = wordsLeft / wpm;

  if (minutesLeft < 1) return '< 1 min left';
  if (minutesLeft < 60) return `~${Math.ceil(minutesLeft)} min left`;
  const h = Math.floor(minutesLeft / 60);
  const m = Math.round(minutesLeft % 60);
  return `~${h}h ${m}m left`;
}

export function intervalLabel(wpm: number, chunkSize: number): string {
  const intervalMs = Math.round(wpmToInterval(wpm, chunkSize));
  return `${intervalMs} ms/chunk`;
}
