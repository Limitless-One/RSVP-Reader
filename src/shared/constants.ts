import type { PunctuationPauses, Settings, ThemeName } from './types';
import { DEFAULT_ENABLED_SITE_HOSTS, DEFAULT_ENABLED_SITES, DEFAULT_FAVORITE_SITES } from './sites';

// ─── Default punctuation pauses ──────────────────────────────────────────────────
// Values match the hardcoded PACING constants so behaviour is unchanged
// for existing users until they adjust the slider.
export const DEFAULT_PUNCTUATION_PAUSES: PunctuationPauses = {
  clause:      1.3, // PACING.CLAUSE
  sentenceEnd: 1.8, // PACING.SENTENCE_END
  dash:        2.0, // PACING.DASH
  ellipsis:    2.0, // PACING.ELLIPSIS
};

// ─── Default settings ─────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: Settings = {
  chunkSize: 1,
  adaptiveChunkSizing: true,
  wpm: 300,
  warmupRamp: true,
  wpmStep: 10,
  skipBackSeconds: 5,
  readingMode: 'balanced',
  segmentationMode: 'phrase',
  readAloudEnabled: false,
  ttsProvider: 'chrome',
  ttsVoiceName: '',
  ttsRate: 1,
  localTtsModelId: 'kitten-tts-nano-v0.8-int8',
  localTtsVoiceId: 'Jasper',

  font: 'Georgia, serif',
  fontSize: 48,
  textColor: '#f0ece3',
  backgroundColor: '#1a1a2e',
  backgroundImage: '',
  overlayOpacity: 0.97,
  theme: 'dark',
  showStats: true,
  highlightParagraph: true,
  peripheralVisionMode: false,

  adhdBionic: false,
  adhdFocalPoint: true,
  focalPointColor: '#e05a5a',

  adaptivePacing: true,
  punctuationPauses: DEFAULT_PUNCTUATION_PAUSES,
  sentenceMode: false,
  authorNotesMode: 'exclude',
  autoAdvanceChapter: true,
  autoAdvanceDelaySeconds: 3,
  enabledSites: DEFAULT_ENABLED_SITES,
  enabledSiteHosts: DEFAULT_ENABLED_SITE_HOSTS,
  favoriteSites: DEFAULT_FAVORITE_SITES,
  preferTranslatedText: true,
  speedTrainerEnabled: false,

  personalizationEnabled: false,
  personalizationConsentGiven: false,
  personalizationWordsSinceTraining: 0,
  personalizationLastTrainedAt: null,

  shortcuts: {
    playPause: ' ',
    back: 'ArrowLeft',
    forward: 'ArrowRight',
    speedUp: 'ArrowUp',
    speedDown: 'ArrowDown',
    close: 'Escape',
    backSentence: 'shift+ArrowLeft',
    forwardSentence: 'shift+ArrowRight',
    skipBack: 'Backspace',
  },
  
  syncEnabled: true,
  enableUpdateChecker: true,
  showFeedbackWidget: true,
};

// ─── Built-in themes ─────────────────────────────────────────────────────────

export interface ThemePreset {
  name: ThemeName;
  label: string;
  backgroundColor: string;
  textColor: string;
  focalPointColor: string;
  font: string;
}

export const THEMES: ThemePreset[] = [
  {
    name: 'dark',
    label: 'Dark (default)',
    backgroundColor: '#1a1a2e',
    textColor: '#f0ece3',
    focalPointColor: '#e05a5a',
    font: 'Georgia, serif',
  },
  {
    name: 'paper',
    label: 'Paper',
    backgroundColor: '#f5f0e8',
    textColor: '#2c2418',
    focalPointColor: '#c0392b',
    font: 'Georgia, serif',
  },
  {
    name: 'solarized',
    label: 'Solarized',
    backgroundColor: '#002b36',
    textColor: '#839496',
    focalPointColor: '#2aa198',
    font: '"Courier New", monospace',
  },
  {
    name: 'highContrast',
    label: 'High contrast',
    backgroundColor: '#000000',
    textColor: '#ffffff',
    focalPointColor: '#ffff00',
    font: 'Arial, sans-serif',
  },
  {
    name: 'academia',
    label: 'Dark academia',
    backgroundColor: '#2c2416',
    textColor: '#d4c5a9',
    focalPointColor: '#b8860b',
    font: '"Palatino Linotype", Palatino, serif',
  },
  {
    name: 'midnight',
    label: 'Midnight blue',
    backgroundColor: '#0f172a',
    textColor: '#e2e8f0',
    focalPointColor: '#38bdf8',
    font: 'Inter, system-ui, sans-serif',
  },
  {
    name: 'forest',
    label: 'Forest',
    backgroundColor: '#10251c',
    textColor: '#e8f3d6',
    focalPointColor: '#84cc16',
    font: 'Georgia, serif',
  },
  {
    name: 'ember',
    label: 'Ember',
    backgroundColor: '#2a1714',
    textColor: '#fde7d7',
    focalPointColor: '#fb923c',
    font: '"Atkinson Hyperlegible", system-ui, sans-serif',
  },
];

// ─── Readable fonts list (shown in settings dropdown) ────────────────────────

export const READABLE_FONTS: { label: string; value: string }[] = [
  { label: 'iA Writer Mono', value: '"iA Writer Mono", ui-monospace, SFMono-Regular, monospace' },
  { label: 'Atkinson Hyperlegible', value: '"Atkinson Hyperlegible", system-ui, sans-serif' },
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Georgia (serif)', value: 'Georgia, serif' },
  { label: 'Palatino', value: '"Palatino Linotype", Palatino, serif' },
];

// ─── Pacing multipliers ───────────────────────────────────────────────────────

export const PACING = {
  SENTENCE_END: 1.8,
  CLAUSE: 1.3,
  DASH: 2.0,
  ELLIPSIS: 2.0,
  NUMBER: 1.4,
  PROPER_NOUN: 1.2,
  LONG_WORD_BASE: 8,
  LONG_WORD_PER_CHAR: 0.1,
  STOP_WORD_RATIO_THRESHOLD: 0.6,
  STOP_WORD_SPEED: 0.75,
  SHORT_WORD_THRESHOLD: 3,
  SHORT_WORD_SPEED: 0.85,
} as const;

// ─── Warmup ramp ─────────────────────────────────────────────────────────────

/** First 10 seconds of active playback are displayed below target speed */
export const WARMUP_DURATION_MS = 10_000;
export const WARMUP_START_RATIO = 0.8;

// ─── WPM step when user presses ↑↓ ──────────────────────────────────────────

export const WPM_STEP = 10;
export const WPM_MIN = 60;
export const WPM_MAX = 1500;

export const AUTOSAVE_INTERVAL_MS = 30_000;
export const STORAGE_SCHEMA_VERSION = 3;
export const PERSONALIZATION_TRAINING_WORDS = 5_000;

// ─── Abbreviations that should NOT trigger sentence-end detection ─────────────

export const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'rev', 'gen', 'sgt', 'cpl',
  'pvt', 'capt', 'maj', 'col', 'lt', 'cmdr', 'adm', 'est', 'etc', 'e.g',
  'i.e', 'vs', 'vol', 'no', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul',
  'aug', 'sep', 'oct', 'nov', 'dec', 'st', 'ave', 'blvd',
]);

export const TIME_OF_DAY_BUCKETS = {
  morning: [5, 12],
  afternoon: [12, 17],
  evening: [17, 21],
} as const;
