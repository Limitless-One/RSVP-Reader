import { WPM_MAX, WPM_MIN } from '../../shared/constants';
import type { Chunk, ParsedBlock, ReadingStats, Settings } from '../../shared/types';
import { chunkDelay, estimateRemaining, warmupMultiplier, wpmToInterval } from './pacing';
import { buildChunks } from './tokenizer';

export type PlayState = 'idle' | 'playing' | 'paused';

export interface EngineState {
  playState: PlayState;
  chunkIndex: number;
  totalChunks: number;
  currentChunk: Chunk | null;
  wpm: number;
  remaining: string;
  totalWords: number;
  nextWordIndex: number;
}

export type EngineEvent =
  | { type: 'state'; state: EngineState }
  | { type: 'chunk'; chunk: Chunk; state: EngineState }
  | { type: 'ended' }
  | { type: 'error'; message: string };

export type EngineListener = (event: EngineEvent) => void;

export class RSVPEngine {
  private chunks: Chunk[] = [];
  private chunkIndex = 0;
  private playState: PlayState = 'idle';
  private wpm: number;
  private settings: Settings;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private listeners: EngineListener[] = [];
  private sourceText = '';
  private sourceBlocks: ParsedBlock[] = [];
  private personalizationPredictor: ((chunk: Chunk) => number) | null = null;

  private sessionStart = 0;
  private activeStart = 0;
  private activeMs = 0;
  private pauseMs = 0;
  private pauseStart = 0;
  private rewinds = 0;
  private pauses = 0;

  constructor(settings: Settings) {
    this.settings = settings;
    this.wpm = settings.wpm;
  }

  load(text: string, blocks: ParsedBlock[], startWordIndex = 0): void {
    this.stop();
    this.sourceText = text;
    this.sourceBlocks = blocks;
    this.chunks = buildChunks(text, blocks, this.settings.chunkSize, this.settings.sentenceMode);
    this.chunkIndex = this.chunkIndexForWord(startWordIndex);
    this.sessionStart = Date.now();
    this.activeMs = 0;
    this.pauseMs = 0;
    this.rewinds = 0;
    this.pauses = 0;
    this.emit({ type: 'state', state: this.buildState() });
  }

  replaceChapter(text: string, blocks: ParsedBlock[], startWordIndex = 0): void {
    const wasPlaying = this.playState === 'playing';
    this.load(text, blocks, startWordIndex);
    if (wasPlaying) this.play();
  }

  play(): void {
    if (this.playState === 'playing' || this.chunks.length === 0) return;

    if (this.playState === 'paused') {
      this.pauseMs += Date.now() - this.pauseStart;
    } else {
      this.sessionStart = Date.now();
    }

    this.playState = 'playing';
    this.activeStart = Date.now();
    this.scheduleNext(true);
  }

  pause(): void {
    if (this.playState !== 'playing') return;
    this.clearTimer();
    this.activeMs += Date.now() - this.activeStart;
    this.pauseStart = Date.now();
    this.pauses++;
    this.playState = 'paused';
    this.emit({ type: 'state', state: this.buildState() });
  }

  togglePlay(): void {
    if (this.playState === 'playing') {
      this.pause();
      return;
    }
    this.play();
  }

  stop(): void {
    this.clearTimer();
    if (this.playState === 'playing') {
      this.activeMs += Date.now() - this.activeStart;
    }
    this.playState = 'idle';
  }

  back(n = 1): void {
    const wasPlaying = this.prepareForNavigation();
    this.rewinds++;
    const targetIndex = Math.max(0, this.currentDisplayedChunkIndex() - n);
    this.navigateToChunk(targetIndex, wasPlaying);
  }

  forward(n = 1): void {
    const wasPlaying = this.prepareForNavigation();
    const targetIndex = Math.min(this.chunks.length - 1, this.currentDisplayedChunkIndex() + n);
    this.navigateToChunk(targetIndex, wasPlaying);
  }

  backSentence(): void {
    let index = Math.max(0, this.chunkIndex - 1);
    while (index > 0 && !this.chunks[index - 1]?.isSentenceEnd) index--;
    this.seekToChunk(index);
  }

  forwardSentence(): void {
    let index = Math.min(this.chunks.length - 1, this.chunkIndex + 1);
    while (index < this.chunks.length - 1 && !this.chunks[index - 1]?.isSentenceEnd) index++;
    this.seekToChunk(index);
  }

  skipBackSeconds(seconds: number): void {
    const wordsToRewind = Math.max(1, Math.ceil((this.wpm / 60) * seconds));
    const targetWordIndex = Math.max(0, this.getResumeWordIndex() - wordsToRewind);
    this.seekToWord(targetWordIndex);
  }

  speedUp(): void {
    this.setWpm(Math.min(WPM_MAX, this.wpm + this.settings.wpmStep));
  }

  speedDown(): void {
    this.setWpm(Math.max(WPM_MIN, this.wpm - this.settings.wpmStep));
  }

  setWpm(wpm: number): void {
    this.wpm = Math.max(WPM_MIN, Math.min(WPM_MAX, wpm));
    this.emit({ type: 'state', state: this.buildState() });
  }

  seekToChunk(index: number): void {
    const wasPlaying = this.prepareForNavigation();
    this.navigateToChunk(index, wasPlaying);
  }

  seekToWord(wordIndex: number): void {
    this.seekToChunk(this.chunkIndexForWord(wordIndex));
  }

  getChunkIndex(): number {
    return this.chunkIndex;
  }

  getTotalChunks(): number {
    return this.chunks.length;
  }

  getTotalWords(): number {
    return this.chunks[this.chunks.length - 1]?.wordEndIndex ?? 0;
  }

  getWpm(): number {
    return this.wpm;
  }

  getPlayState(): PlayState {
    return this.playState;
  }

  getCurrentChunk(): Chunk | null {
    return this.chunks[this.chunkIndex] ?? null;
  }

  setPersonalizationPredictor(predictor: ((chunk: Chunk) => number) | null): void {
    this.personalizationPredictor = predictor;
  }

  getResumeWordIndex(): number {
    return this.getCurrentChunk()?.wordStartIndex ?? this.getTotalWords();
  }

  getSessionStats(): ReadingStats {
    const activeFinal = this.currentActiveMs();
    const wordsRead = this.getResumeWordIndex();
    return {
      wordsRead,
      activeTimeMs: activeFinal,
      pauseTimeMs: this.pauseMs,
      pauses: this.pauses,
      rewinds: this.rewinds,
      sessionStartTs: this.sessionStart,
      effectiveWpm: activeFinal > 0 ? Math.round((wordsRead / activeFinal) * 60_000) : 0,
    };
  }

  getBookmarkSnapshot() {
    return {
      chunkIndex: this.chunkIndex,
      wordIndex: this.getResumeWordIndex(),
      totalChunks: this.getTotalChunks(),
      totalWords: this.getTotalWords(),
    };
  }

  updateSettings(settings: Settings): void {
    const previousSettings = this.settings;
    const resumeWordIndex = this.getResumeWordIndex();
    const needsRebuild =
      settings.chunkSize !== previousSettings.chunkSize ||
      settings.sentenceMode !== previousSettings.sentenceMode;

    this.settings = settings;
    this.wpm = settings.wpm;

    if (needsRebuild && this.sourceText) {
      const wasPlaying = this.playState === 'playing';
      this.chunks = buildChunks(this.sourceText, this.sourceBlocks, settings.chunkSize, settings.sentenceMode);
      this.chunkIndex = this.chunkIndexForWord(resumeWordIndex);
      if (wasPlaying) {
        this.activeStart = Date.now();
      }
    }

    this.emit({ type: 'state', state: this.buildState() });
  }

  on(listener: EngineListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(entry => entry !== listener);
    };
  }

  private scheduleNext(immediate: boolean): void {
    this.clearTimer();
    if (this.playState !== 'playing') return;

    if (immediate) {
      this.showCurrent();
      return;
    }

    const previousIndex = Math.max(0, this.chunkIndex - 1);
    const previousChunk = this.chunks[previousIndex];
    const baseInterval = wpmToInterval(this.wpm, Math.max(1, previousChunk?.wordCount ?? this.settings.chunkSize));
    const warmupRatio = warmupMultiplier(this.currentActiveMs(), this.settings.warmupRamp);
    const personalizationMultiplier = previousChunk && this.personalizationPredictor
      ? this.personalizationPredictor(previousChunk)
      : 1;
    const delay =
      (chunkDelay(previousChunk, baseInterval, this.settings.adaptivePacing, this.settings.punctuationPauses) * personalizationMultiplier) /
      warmupRatio;

    this.timerId = setTimeout(() => this.showCurrent(), delay);
  }

  private showCurrent(): void {
    if (this.playState !== 'playing') return;
    if (this.chunkIndex >= this.chunks.length) {
      this.stop();
      this.emit({ type: 'ended' });
      return;
    }

    const chunk = this.chunks[this.chunkIndex];
    this.chunkIndex++;
    this.emit({ type: 'chunk', chunk, state: this.buildState(chunk) });
    this.scheduleNext(false);
  }

  private clearTimer(): void {
    if (this.timerId === null) return;
    clearTimeout(this.timerId);
    this.timerId = null;
  }

  private buildState(currentChunk = this.getCurrentChunk()): EngineState {
    return {
      playState: this.playState,
      chunkIndex: this.chunkIndex,
      totalChunks: this.chunks.length,
      currentChunk,
      wpm: this.wpm,
      remaining: estimateRemaining(
        this.chunkIndex,
        this.chunks.length,
        this.wpm,
        this.settings.chunkSize,
      ),
      totalWords: this.getTotalWords(),
      nextWordIndex: this.getResumeWordIndex(),
    };
  }

  private chunkIndexForWord(wordIndex: number): number {
    if (this.chunks.length === 0) return 0;
    const target = Math.max(0, wordIndex);
    const index = this.chunks.findIndex(chunk => chunk.wordEndIndex > target);
    return index === -1 ? Math.max(0, this.chunks.length - 1) : index;
  }

  private currentActiveMs(): number {
    return this.playState === 'playing'
      ? this.activeMs + (Date.now() - this.activeStart)
      : this.activeMs;
  }

  private emit(event: EngineEvent): void {
    this.listeners.forEach(listener => listener(event));
  }

  private currentDisplayedChunkIndex(): number {
    if (this.chunks.length === 0) return 0;
    return Math.max(0, Math.min(this.chunks.length - 1, this.chunkIndex - 1));
  }

  private prepareForNavigation(): boolean {
    const wasPlaying = this.playState === 'playing';
    this.clearTimer();
    if (wasPlaying) {
      this.activeMs += Date.now() - this.activeStart;
      this.playState = 'paused';
    } else if (this.playState === 'idle' && this.chunks.length > 0) {
      this.playState = 'paused';
    }
    return wasPlaying;
  }

  private navigateToChunk(index: number, resumePlaying: boolean): void {
    if (this.chunks.length === 0) {
      this.emit({ type: 'state', state: this.buildState() });
      return;
    }

    const clampedIndex = Math.max(0, Math.min(this.chunks.length - 1, index));
    const chunk = this.chunks[clampedIndex];
    this.chunkIndex = clampedIndex + 1;

    if (resumePlaying) {
      this.playState = 'playing';
      this.activeStart = Date.now();
    }

    this.emit({ type: 'chunk', chunk, state: this.buildState(chunk) });
    if (resumePlaying) {
      this.scheduleNext(false);
    }
  }
}
