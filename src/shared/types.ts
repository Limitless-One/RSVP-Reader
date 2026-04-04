// ─── Token & Chunk ───────────────────────────────────────────────────────────

export type TokenType = 'word' | 'number' | 'punctuation';

/** What kind of pause follows this token (if any) */
export type PunctuationType = 'none' | 'clause' | 'sentence' | 'dash' | 'ellipsis';

export interface Token {
  text: string;
  type: TokenType;
  start: number;
  end: number;
  spaceBefore: boolean;
  wordIndex: number | null;
  isStopWord: boolean;
  /** Title-cased but not sentence-initial */
  isProperNoun: boolean;
  /** Pause weight injected after this token */
  punctuationAfter: PunctuationType;
  charCount: number;
}

/** A displayable unit: 1..N tokens shown at once */
export interface Chunk {
  tokens: Token[];
  /** Exact text slice from the source chapter */
  rawText: string;
  displayText: string;
  /** Index in the full chunks array */
  index: number;
  /** Sentence boundary ends this chunk (used by sentenceMode) */
  isSentenceEnd: boolean;
  startOffset: number;
  endOffset: number;
  wordStartIndex: number;
  wordEndIndex: number;
  wordCount: number;
  blockIds: string[];
  isDialogue: boolean;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export type ThemeName =
  | 'custom'
  | 'dark'
  | 'paper'
  | 'solarized'
  | 'highContrast'
  | 'academia'
  | 'midnight'
  | 'forest'
  | 'ember';

export type AuthorNotesMode = 'exclude' | 'include';
export type SiteId =
  | 'royalroad'
  | 'scribblehub'
  | 'webnovel'
  | 'wattpad'
  | 'ao3'
  | 'fanfiction'
  | 'xenforo'
  | 'novelbin'
  | 'ranobes'
  | 'wtrlab'
  | 'wordpress'
  | 'generic';

export interface ShortcutMap {
  playPause: string;
  back: string;
  forward: string;
  speedUp: string;
  speedDown: string;
  close: string;
  backSentence: string;
  forwardSentence: string;
  skipBack: string;
}

/**
 * Per-punctuation-type pause multipliers applied on top of the base interval.
 * A value of 1.0 means no extra pause; 2.0 means twice as long.
 */
export interface PunctuationPauses {
  /** Clause punctuation: , ; : */
  clause: number;
  /** Sentence-ending punctuation: . ! ? */
  sentenceEnd: number;
  /** Em dash / en dash: — – */
  dash: number;
  /** Ellipsis: ... or … */
  ellipsis: number;
}

export interface PersonalizationSnapshot {
  enabled: boolean;
  consentGiven: boolean;
  wordsSinceTraining: number;
  lastTrainedAt: number | null;
}

export interface Settings {
  // ── Playback ──
  chunkSize: number;          // words per chunk (1–5)
  wpm: number;                // base words per minute (100–1500)
  warmupRamp: boolean;        // slow start for first ~10 s
  wpmStep: number;            // step for keyboard / quick controls
  skipBackSeconds: number;    // approximate rewind action

  // ── Display ──
  font: string;               // CSS font-family name
  fontSize: number;           // px (24–96)
  textColor: string;          // hex
  backgroundColor: string;    // hex
  backgroundImage: string;    // base64 data URL | ''
  overlayOpacity: number;     // 0.7–1.0 (backdrop alpha)
  theme: ThemeName;
  showStats: boolean;
  highlightParagraph: boolean;

  // ── ADHD features ──
  adhdBionic: boolean;        // bold leading chars
  adhdFocalPoint: boolean;    // ORP guide line
  focalPointColor: string;    // hex

  // ── Reading intelligence ──
  adaptivePacing: boolean;    // rule-based pacing multipliers
  punctuationPauses: PunctuationPauses; // per-type pause multipliers
  sentenceMode: boolean;      // snap chunks to sentence boundaries
  authorNotesMode: AuthorNotesMode;
  autoAdvanceChapter: boolean;
  autoAdvanceDelaySeconds: number;
  enabledSites: SiteId[];
  enabledSiteHosts: string[];
  favoriteSites: SiteId[];
  preferTranslatedText: boolean;

  // ── Personalization (Phase 4, opt-in) ──
  personalizationEnabled: boolean;
  personalizationConsentGiven: boolean;
  personalizationWordsSinceTraining: number;
  personalizationLastTrainedAt: number | null;

  // ── Keyboard shortcuts ──
  shortcuts: ShortcutMap;
}

// ─── Parsed chapter data ─────────────────────────────────────────────────────

export interface ParsedBlock {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface ParsedChapter {
  title: string;
  text: string;
  site: string;
  prevChapterUrl: string | null;
  nextChapterUrl: string | null;
  blocks: ParsedBlock[];
}

// ─── Bookmarks ───────────────────────────────────────────────────────────────

export interface Bookmark {
  version: 2;
  url: string;
  chunkIndex: number;
  wordIndex: number;
  totalChunks: number;
  totalWords: number;
  chapterTitle: string;
  site: string;
  timestamp: number;
}

// ─── Reading stats (in-memory per session) ───────────────────────────────────

export interface ReadingStats {
  wordsRead: number;
  activeTimeMs: number;
  pauseTimeMs: number;
  pauses: number;
  rewinds: number;
  sessionStartTs: number;
  effectiveWpm: number;
}

export interface PersonalizationEvent {
  id: string;
  chapterUrl: string;
  chunkIndex: number;
  wordIndex: number;
  wordLength: number;
  isProperNoun: boolean;
  isNumber: boolean;
  stopWordRatio: number;
  sentencePosition: number;
  paragraphDensity: number;
  timeOfDayBucket: 'morning' | 'afternoon' | 'evening' | 'night';
  sessionDurationMinutes: number;
  wordsReadToday: number;
  action: 'rewind' | 'pause' | 'speed_down' | 'speed_up' | 'pass';
  createdAt: number;
}

export interface PersonalizationModel {
  weights: number[];
  bias: number;
  trainedAt: number;
}

export interface ExportBundle {
  version: 1;
  settings: Settings;
  bookmarks: Bookmark[];
  personalization: {
    events: PersonalizationEvent[];
    model: PersonalizationModel | null;
  };
}

// ─── Extension messages ──────────────────────────────────────────────────────

export type ExtMessage =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; settings: Partial<Settings> }
  | { type: 'RESET_SETTINGS' }
  | { type: 'OPEN_OPTIONS' }
  | { type: 'OPEN_READER_ON_TAB'; tabId: number }
  | { type: 'GET_BOOKMARK'; url: string }
  | { type: 'SAVE_BOOKMARK'; bookmark: Bookmark }
  | { type: 'DELETE_BOOKMARK'; url: string }
  | { type: 'GET_ALL_BOOKMARKS' }
  | { type: 'EXPORT_BUNDLE' }
  | { type: 'IMPORT_BUNDLE'; bundle: ExportBundle }
  | { type: 'GET_PERSONALIZATION_EVENTS' }
  | { type: 'SAVE_PERSONALIZATION_EVENTS'; events: PersonalizationEvent[] }
  | { type: 'GET_PERSONALIZATION_MODEL' }
  | { type: 'SAVE_PERSONALIZATION_MODEL'; model: PersonalizationModel | null }
  | { type: 'RESET_PERSONALIZATION' }
  | { type: 'OVERLAY_OPENED' }
  | { type: 'OVERLAY_CLOSED'; stats?: ReadingStats };

export type ExtResponse<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
