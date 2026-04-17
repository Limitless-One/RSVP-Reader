import { AUTOSAVE_INTERVAL_MS } from '../../shared/constants';
import {
  createEmptyTrainingProgress,
  evaluateTrainingSession,
  getTrainingLevel,
} from '../../shared/training';
import type {
  Chunk,
  ExtMessage,
  ParsedChapter,
  PersonalizationEvent,
  PersonalizationModel,
  ReadingTrainingProgress,
  ReadingStats,
  Settings,
} from '../../shared/types';
import { clearHighlightedBlocks, ensurePageHighlightStyle, setHighlightedBlocks } from '../page-highlight';
import type { EngineState } from './engine';
import { RSVPEngine } from './engine';
import { chunkDelay, intervalLabel, wpmToInterval } from './pacing';
import { makeEvent, predictDelayMultiplier, shouldTrain, trainModel } from './personalization';
import { effectiveSpeechRate, neuralSpeechRate, speechTextForChunk, speechTextForSentence } from './read-aloud';
import { renderChunkHtml } from './tokenizer';
import { submitFeedback } from '../../shared/feedback-api';
import overlayCSS from './overlay.css?inline';

const ICON = {
  play: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 2.5l11 5.5-11 5.5V2.5z"/></svg>`,
  pause: `<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="4" height="12" rx="1"/><rect x="9" y="2" width="4" height="12" rx="1"/></svg>`,
  back: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M7 2L2 8l5 6V9.5l5 4.5V2L7 6.5V2z"/></svg>`,
  forward: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9 2l5 6-5 6V9.5L4 14V2l5 4.5V2z"/></svg>`,
  rewind: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M7.5 3L1 8l6.5 5V9l6.5 4V3L7.5 7V3z"/></svg>`,
  settings: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4" stroke-linecap="round"/></svg>`,
  close: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>`,
  bookmark: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h10v14l-5-3.5L3 15V1z"/></svg>`,
  stats: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 12V8M8 12V4M13 12V6" stroke-linecap="round"/><path d="M2 13.5h12" stroke-linecap="round"/></svg>`,
  chevLeft: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L6 8l4 5"/></svg>`,
  chevRight: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l4 5-4 5"/></svg>`,
};

export interface OverlayBookmarkSnapshot {
  chunkIndex: number;
  wordIndex: number;
  totalChunks: number;
  totalWords: number;
}

export class RSVPOverlay {
  private host!: HTMLElement;
  private shadow!: ShadowRoot;
  private engine!: RSVPEngine;
  private settings: Settings;
  private chapter: ParsedChapter;

  private backdrop!: HTMLElement;
  private previousWrap!: HTMLElement;
  private wordWrap!: HTMLElement;
  private nextWrap!: HTMLElement;
  private focalLine!: HTMLElement;
  private progressFill!: HTMLElement;
  private progressTrack!: HTMLElement;
  private progressLabel!: HTMLElement;
  private wpmDisplay!: HTMLElement;
  private statsText!: HTMLElement;
  private statsPanel!: HTMLElement;
  private statsBody!: HTMLElement;
  private statsToggleBtn!: HTMLButtonElement;
  private playBtn!: HTMLButtonElement;
  private speedBump!: HTMLElement;
  private toast!: HTMLElement;
  private chapterTitle!: HTMLElement;
  private hints!: HTMLElement;
  private displayArea!: HTMLElement;
  private keySink!: HTMLTextAreaElement;

  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private speedBumpTimer: ReturnType<typeof setTimeout> | null = null;
  private hintsTimer: ReturnType<typeof setTimeout> | null = null;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private autoAdvanceTimer: ReturnType<typeof setInterval> | null = null;
  private scrollDeltaAccum = 0;
  private isOpen = false;
  private lastRenderedChunk: Chunk | null = null;
  private lastHighlightedBlockIds: string[] = [];
  private personalizationEvents: PersonalizationEvent[] = [];
  private personalizationModel: PersonalizationModel | null = null;
  private trainingProgress: ReadingTrainingProgress | null = null;
  private ttsRequestId = 0;
  private ttsActiveRequestId = 0;
  private readonly ttsClientId?: string;
  /** Chunks accumulated since the last sentence-level neural TTS fire. */
  private ttsSentenceBuffer: Chunk[] = [];

  private boundKeyDown: (event: KeyboardEvent) => void;
  private boundKeyUp: (event: KeyboardEvent) => void;
  private boundKeyPress: (event: KeyboardEvent) => void;
  private boundWheel: (event: WheelEvent) => void;
  private boundDisplayClick: (event: MouseEvent) => void;

  private onCloseCallback?: (bookmark: OverlayBookmarkSnapshot, stats: ReadingStats) => void;
  private onSettingsCallback?: () => void;

  constructor(settings: Settings, chapter: ParsedChapter, ttsClientId?: string) {
    this.settings = settings;
    this.chapter = chapter;
    this.ttsClientId = ttsClientId;
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundKeyPress = this.handleKeyPress.bind(this);
    this.boundWheel = this.handleWheel.bind(this);
    this.boundDisplayClick = this.handleDisplayClick.bind(this);
  }

  open(
    startWordIndex = 0,
    onClose?: (bookmark: OverlayBookmarkSnapshot, stats: ReadingStats) => void,
    onSettings?: () => void,
  ): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.onCloseCallback = onClose;
    this.onSettingsCallback = onSettings;

    this.buildDOM();
    this.applyTheme();
    ensurePageHighlightStyle();

    this.engine = new RSVPEngine(this.settings);
    this.engine.load(this.chapter.text, this.chapter.blocks, startWordIndex);
    this.engine.on(event => {
      if (event.type === 'chunk') {
        this.renderChunk(event.chunk, event.state);
      } else if (event.type === 'state') {
        this.syncState(event.state);
      } else if (event.type === 'ended') {
        this.handleEnded();
      }
    });

    window.addEventListener('keydown', this.boundKeyDown, { capture: true });
    window.addEventListener('keyup', this.boundKeyUp, { capture: true });
    window.addEventListener('keypress', this.boundKeyPress, { capture: true });
    this.backdrop.addEventListener('wheel', this.boundWheel, { passive: false });
    this.displayArea.addEventListener('click', this.boundDisplayClick);

    this.flashHints();
    this.startAutosave();
    void this.loadTrainingProgress();
    void this.loadPersonalization();
    this.engine.play();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.engine?.pause();
    this.stopReadAloud();
    this.stopAutosave();
    this.clearAutoAdvance();
    if (this.hintsTimer) clearTimeout(this.hintsTimer);
    clearHighlightedBlocks();
    window.removeEventListener('keydown', this.boundKeyDown, { capture: true });
    window.removeEventListener('keyup', this.boundKeyUp, { capture: true });
    window.removeEventListener('keypress', this.boundKeyPress, { capture: true });
    this.displayArea?.removeEventListener('click', this.boundDisplayClick);
    this.host?.remove();
    void this.flushPersonalization();
    if (this.engine) {
      this.onCloseCallback?.(this.engine.getBookmarkSnapshot(), this.engine.getSessionStats());
    }
  }

  updateSettings(settings: Settings): void {
    const readAloudWasEnabled = this.settings.readAloudEnabled;
    this.settings = settings;
    this.engine?.updateSettings(settings);
    this.applyTheme();
    this.statsPanel?.classList.toggle('hidden', !shouldShowStatsPanel(settings));
    this.statsToggleBtn.innerHTML = `${ICON.stats} ${statsToggleLabel(settings)}`;
    this.focalLine?.classList.toggle('visible', settings.adhdFocalPoint);
    this.displayArea?.classList.toggle('peripheral-enabled', settings.peripheralVisionMode);
    if (!settings.readAloudEnabled && readAloudWasEnabled) {
      this.stopReadAloud();
      this.engine?.setExternalHold(false);
    }
    if (!settings.highlightParagraph) {
      this.lastHighlightedBlockIds = [];
      clearHighlightedBlocks();
    }
    if (this.lastRenderedChunk) {
      this.renderPeripheralContext(this.lastRenderedChunk);
    }
    if (settings.speedTrainerEnabled && !this.trainingProgress) {
      void this.loadTrainingProgress();
    }
    if (!settings.speedTrainerEnabled) {
      this.trainingProgress = null;
    }
    this.updateStatsPanel();
  }

  replaceChapter(chapter: ParsedChapter, startWordIndex = 0): void {
    this.chapter = chapter;
    this.chapterTitle.textContent = chapter.title;
    this.stopReadAloud();
    this.engine.replaceChapter(chapter.text, chapter.blocks, startWordIndex);
  }

  getBookmarkSnapshot(): OverlayBookmarkSnapshot {
    return this.engine.getBookmarkSnapshot();
  }

  private buildDOM(): void {
    this.host = document.createElement('div');
    this.host.id = 'rsvp-reader-root';
    this.keySink = document.createElement('textarea');
    this.keySink.setAttribute('aria-hidden', 'true');
    Object.assign(this.keySink.style, {
      position: 'fixed',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
      left: '-9999px',
      top: '-9999px',
    });
    this.host.appendChild(this.keySink);
    this.shadow = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = overlayCSS;
    this.shadow.appendChild(style);

    this.backdrop = el('div', 'rsvp-backdrop');
    if (isSafeBackgroundImageUrl(this.settings.backgroundImage)) {
      this.backdrop.classList.add('has-bg-image');
      this.backdrop.style.backgroundImage = `url(${this.settings.backgroundImage})`;
    }
    this.shadow.appendChild(this.backdrop);
    const panel = el('div', 'rsvp-panel');
    this.backdrop.appendChild(panel);

    const header = el('div', 'rsvp-header');
    this.chapterTitle = el('span', 'rsvp-chapter-title');
    this.chapterTitle.textContent = this.chapter.title;

    const topControls = el('div', 'rsvp-top-controls');
    this.wpmDisplay = el('span', 'rsvp-wpm-display');
    this.wpmDisplay.textContent =
      `${this.settings.wpm} WPM · ${intervalLabel(this.settings.wpm, this.settings.chunkSize, this.settings.segmentationMode, this.settings.adaptiveChunkSizing)}`;

    const chapterNav = el('div', 'rsvp-chapter-nav');
    if (this.chapter.prevChapterUrl) {
      const prevBtn = iconBtn(ICON.chevLeft, 'Previous chapter');
      prevBtn.addEventListener('click', () => {
        location.href = this.chapter.prevChapterUrl!;
      });
      chapterNav.appendChild(prevBtn);
    }
    if (this.chapter.nextChapterUrl) {
      const nextBtn = iconBtn(ICON.chevRight, 'Next chapter');
      nextBtn.addEventListener('click', () => {
        location.href = this.chapter.nextChapterUrl!;
      });
      chapterNav.appendChild(nextBtn);
    }

    const settingsBtn = iconBtn(ICON.settings, 'Settings');
    settingsBtn.addEventListener('click', () => this.onSettingsCallback?.());

    const closeBtn = iconBtn(ICON.close, 'Close (Esc)');
    closeBtn.addEventListener('click', () => this.close());

    topControls.append(this.wpmDisplay, chapterNav, settingsBtn, closeBtn);
    header.append(this.chapterTitle, topControls);
    panel.appendChild(header);

    const display = el('div', 'rsvp-display');
    this.displayArea = display;
    this.displayArea.classList.toggle('peripheral-enabled', this.settings.peripheralVisionMode);
    this.focalLine = el('div', 'rsvp-focal-line');
    this.focalLine.classList.toggle('visible', this.settings.adhdFocalPoint);
    const contextRail = el('div', 'rsvp-context-rail');
    this.previousWrap = el('div', 'rsvp-side-word rsvp-side-word-prev');
    this.previousWrap.textContent = '';
    this.wordWrap = el('div', 'rsvp-word-wrap');
    this.wordWrap.innerHTML = '<span class="rsvp-word">·</span>';
    this.nextWrap = el('div', 'rsvp-side-word rsvp-side-word-next');
    this.nextWrap.textContent = '';
    contextRail.append(this.previousWrap, this.wordWrap, this.nextWrap);
    display.append(this.focalLine, contextRail);
    panel.appendChild(display);

    const progressArea = el('div', 'rsvp-progress-area');
    this.progressLabel = el('div', 'rsvp-progress-label');
    this.progressTrack = el('div', 'rsvp-progress-track');
    this.progressFill = el('div', 'rsvp-progress-fill');
    this.progressTrack.appendChild(this.progressFill);
    this.progressTrack.addEventListener('click', event => this.handleProgressClick(event));
    progressArea.append(this.progressLabel, this.progressTrack);
    panel.appendChild(progressArea);

    this.statsPanel = el('div', 'rsvp-session-panel');
    this.statsPanel.classList.toggle('hidden', !shouldShowStatsPanel(this.settings));
    this.statsToggleBtn = ctrlBtn(`${ICON.stats} ${statsToggleLabel(this.settings)}`, 'Toggle session details');
    this.statsToggleBtn.classList.add('secondary');
    this.statsToggleBtn.addEventListener('click', () => {
      this.statsBody.classList.toggle('hidden');
    });
    this.statsBody = el('div', 'rsvp-session-body');
    this.statsPanel.append(this.statsToggleBtn, this.statsBody);
    panel.appendChild(this.statsPanel);

    const footer = el('div', 'rsvp-footer');
    const controls = el('div', 'rsvp-controls');

    const backBtn = ctrlBtn(`${ICON.back} Back`, 'Back 1 chunk');
    backBtn.addEventListener('click', () => this.handleRewind(() => this.engine?.back()));

    const rewindBtn = ctrlBtn(`${ICON.rewind} -${this.settings.skipBackSeconds}s`, 'Skip back 5 seconds');
    rewindBtn.addEventListener('click', () => this.handleRewind(() => this.engine?.skipBackSeconds(this.settings.skipBackSeconds)));

    this.playBtn = ctrlBtn(`${ICON.pause} Pause`, 'Play or pause');
    this.playBtn.classList.add('primary');
    this.playBtn.addEventListener('click', () => this.handlePlayPause());

    const forwardBtn = ctrlBtn(`Next ${ICON.forward}`, 'Forward 1 chunk');
    forwardBtn.addEventListener('click', () => this.handleNavigation(() => this.engine?.forward()));

    const bookmarkBtn = ctrlBtn(`${ICON.bookmark} Save`, 'Save bookmark');
    bookmarkBtn.addEventListener('click', () => this.emitBookmarkSave());

    controls.append(backBtn, rewindBtn, this.playBtn, forwardBtn, bookmarkBtn);
    
    if (this.settings.showFeedbackWidget) {
      const feedbackBtn = ctrlBtn(`💬 Feedback`, 'Send Feedback');
      feedbackBtn.addEventListener('click', () => {
        const modal = this.shadow.querySelector('.rsvp-modal-backdrop') as HTMLElement;
        if (modal) modal.classList.add('visible');
        if (this.engine?.getPlayState() === 'playing') {
          this.handlePlayPause();
        }
      });
      controls.append(feedbackBtn);
    }

    this.statsText = el('div', 'rsvp-stats-text');
    footer.append(controls, this.statsText);
    panel.appendChild(footer);

    if (this.settings.showFeedbackWidget) {
      const modalBackdrop = el('div', 'rsvp-modal-backdrop');
      modalBackdrop.addEventListener('click', () => modalBackdrop.classList.remove('visible'));

      const modalContent = el('div', 'rsvp-modal-content');
      modalContent.addEventListener('click', e => e.stopPropagation());

      const modalHeader = el('div', 'rsvp-modal-header');
      modalHeader.textContent = 'Send Feedback';
      const closeModBtn = document.createElement('button');
      closeModBtn.className = 'rsvp-modal-close';
      closeModBtn.innerHTML = ICON.close;
      closeModBtn.addEventListener('click', () => modalBackdrop.classList.remove('visible'));
      modalHeader.appendChild(closeModBtn);

      const feedbackPanel = el('div', 'rsvp-feedback-panel');

      const typeSelect = document.createElement('select');
      typeSelect.className = 'rsvp-feedback-select';
      typeSelect.innerHTML = `
        <option value="general">General</option>
        <option value="bug">Bug</option>
        <option value="feature_request">Feature Request</option>
      `;

      const ratingGroup = el('div', 'rsvp-feedback-rating');
      const ratings = [
        { value: 'positive', label: '😊' },
        { value: 'neutral', label: '😐', active: true },
        { value: 'negative', label: '😞' },
      ];
      ratings.forEach(r => {
        const btn = document.createElement('button');
        btn.className = `rsvp-feedback-chip ${r.active ? 'active' : ''}`;
        btn.dataset['value'] = r.value;
        btn.textContent = r.label;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          Array.from(ratingGroup.children).forEach(c => c.classList.remove('active'));
          btn.classList.add('active');
        });
        ratingGroup.appendChild(btn);
      });

      const topRow = el('div', 'rsvp-feedback-row');
      topRow.append(typeSelect, ratingGroup);

      const msgInput = document.createElement('textarea');
      msgInput.className = 'rsvp-feedback-input';
      msgInput.placeholder = "What's on your mind? Anonymous.";
      msgInput.rows = 3;

      msgInput.addEventListener('keydown', e => {
        e.stopPropagation(); // prevent global keybinds
      });
      msgInput.addEventListener('keyup', e => e.stopPropagation());
      msgInput.addEventListener('keypress', e => e.stopPropagation());

      const bottomRow = el('div', 'rsvp-feedback-row rsvp-feedback-actions');
      const statusSpan = el('span', 'rsvp-feedback-status');
      const submitBtn = document.createElement('button');
      submitBtn.className = 'rsvp-ctrl-btn secondary';
      submitBtn.textContent = 'Submit';

      submitBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const message = msgInput.value.trim();
        if (!message) {
          statusSpan.textContent = 'Please enter a message.';
          statusSpan.style.color = '#ef4444';
          return;
        }

        const type = typeSelect.value as any;
        const activeRating = ratingGroup.querySelector('.active') as HTMLElement;
        const rating = activeRating ? activeRating.dataset['value'] as any : undefined;

        submitBtn.disabled = true;
        submitBtn.textContent = '...';
        try {
          await submitFeedback({ type, rating, message });
          statusSpan.textContent = 'Thank you!';
          statusSpan.style.color = 'var(--rsvp-focal-color, #fb923c)';
          msgInput.value = '';
          setTimeout(() => {
             modalBackdrop.classList.remove('visible');
             statusSpan.textContent = '';
          }, 1500);
        } catch (err: any) {
          statusSpan.textContent = 'Error sending.';
          statusSpan.style.color = '#ef4444';
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit';
          setTimeout(() => {
            statusSpan.textContent = '';
          }, 4000);
        }
      });

      bottomRow.append(statusSpan, submitBtn);

      feedbackPanel.append(topRow, msgInput, bottomRow);
      modalContent.append(modalHeader, feedbackPanel);
      modalBackdrop.appendChild(modalContent);
      this.backdrop.appendChild(modalBackdrop);
    }

    this.toast = el('div', 'rsvp-toast');
    this.speedBump = el('div', 'rsvp-speed-bump');
    this.hints = el('div', 'rsvp-hints');
    this.hints.innerHTML = [
      '<kbd>Click</kbd> play/pause',
      '<kbd>Wheel</kbd> speed',
      '<kbd>←</kbd><kbd>→</kbd> move',
      '<kbd>↑</kbd><kbd>↓</kbd> speed',
      '<kbd>Backspace</kbd> rewind',
      '<kbd>Esc</kbd> close',
    ].join('<br>');

    this.backdrop.append(this.toast, this.speedBump, this.hints);
    this.host.tabIndex = -1;
    document.body.appendChild(this.host);
    this.host.focus({ preventScroll: true });
    this.keySink.focus({ preventScroll: true });
  }

  private applyTheme(): void {
    if (!this.backdrop) return;
    const overlayAlpha =
      this.settings.highlightParagraph && !this.settings.backgroundImage
        ? Math.min(this.settings.overlayOpacity, 0.78)
        : 1;
    this.backdrop.style.setProperty('--rsvp-bg', withAlpha(this.settings.backgroundColor, overlayAlpha));
    this.backdrop.style.setProperty('--rsvp-text', this.settings.textColor);
    this.backdrop.style.setProperty('--rsvp-font', this.settings.font);
    this.backdrop.style.setProperty('--rsvp-font-size', `${this.settings.fontSize}px`);
    this.backdrop.style.setProperty('--rsvp-focal-color', this.settings.focalPointColor);
    this.backdrop.style.setProperty('--rsvp-overlay-opacity', '1');
    this.displayArea?.classList.toggle('peripheral-enabled', this.settings.peripheralVisionMode);
    if (isSafeBackgroundImageUrl(this.settings.backgroundImage)) {
      this.backdrop.classList.add('has-bg-image');
      this.backdrop.style.backgroundImage = `url(${this.settings.backgroundImage})`;
    } else {
      this.backdrop.classList.remove('has-bg-image');
      this.backdrop.style.backgroundImage = '';
    }
  }

  private renderChunk(chunk: Chunk, state: EngineState): void {
    this.lastRenderedChunk = chunk;
    const html = renderChunkHtml(chunk, this.settings.adhdBionic, this.settings.readingMode);
    this.wordWrap.innerHTML = `<span class="rsvp-word">${html}</span>`;
    this.wordWrap.classList.toggle('is-dialogue', this.settings.readingMode === 'dialogue' && chunk.isDialogue);
    this.wordWrap.classList.toggle(
      'is-technical',
      this.settings.readingMode === 'technical' && (chunk.containsNumber || chunk.isCodeLike),
    );
    this.wordWrap.classList.remove('flash');
    void this.wordWrap.offsetWidth;
    this.wordWrap.classList.add('flash');
    this.renderPeripheralContext(chunk);
    this.syncState(state);
    this.updateFocalPosition(chunk);
    this.updateStatsPanel();
    this.updateHighlight(chunk);
    if (this.settings.readAloudEnabled) {
      const isNeural = this.settings.ttsProvider === 'local-neural';
      if (isNeural) {
        // Neural TTS: accumulate into a sentence buffer; fire-and-forget, no hold
        this.accumulateSentenceChunk(chunk);
      } else {
        // Chrome/system TTS: per-chunk + externalHold (existing behaviour)
        this.engine?.setExternalHold(true);
        this.speakCurrentChunk(chunk);
      }
    } else {
      this.engine?.setExternalHold(false);
    }
    if (this.settings.personalizationEnabled && this.settings.personalizationConsentGiven && chunk.index % 8 === 0) {
      this.recordPersonalization('pass', chunk);
    }
  }

  private syncState(state: EngineState): void {
    const progressRatio = state.totalWords > 0 ? state.nextWordIndex / state.totalWords : 0;
    this.progressFill.style.width = `${(progressRatio * 100).toFixed(2)}%`;
    this.progressLabel.textContent = `${Math.round(progressRatio * 100)}% read`;
    this.wpmDisplay.textContent =
      `${state.wpm} WPM · ${intervalLabel(state.wpm, this.settings.chunkSize, this.settings.segmentationMode, this.settings.adaptiveChunkSizing)}`;
    this.playBtn.innerHTML =
      state.playState === 'playing' ? `${ICON.pause} Pause` : `${ICON.play} Play`;
    this.statsText.textContent = `${state.nextWordIndex} / ${state.totalWords} words · ${state.remaining}`;
  }

  private renderPeripheralContext(chunk: Chunk): void {
    if (!this.settings.peripheralVisionMode) {
      this.previousWrap.innerHTML = '';
      this.nextWrap.innerHTML = '';
      this.previousWrap.classList.remove('visible');
      this.nextWrap.classList.remove('visible');
      return;
    }

    const previousChunk = this.engine?.peekChunk(chunk.index - 1);
    const nextChunk = this.engine?.peekChunk(chunk.index + 1);

    this.previousWrap.innerHTML = previousChunk
      ? `<span class="rsvp-side-word-text">${renderChunkHtml(previousChunk, false, this.settings.readingMode)}</span>`
      : '';
    this.nextWrap.innerHTML = nextChunk
      ? `<span class="rsvp-side-word-text">${renderChunkHtml(nextChunk, false, this.settings.readingMode)}</span>`
      : '';
    this.previousWrap.classList.toggle('visible', Boolean(previousChunk));
    this.nextWrap.classList.toggle('visible', Boolean(nextChunk));
  }

  private updateFocalPosition(chunk: Chunk): void {
    if (!this.settings.adhdFocalPoint) return;
    const firstTokenChars = chunk.tokens.find(token => token.type !== 'punctuation')?.charCount ?? 1;
    const totalChars = chunk.tokens.reduce((sum, token) => sum + token.charCount, 0);
    const orp = (firstTokenChars * 0.35) / Math.max(1, totalChars);
    const focalXPct = Math.round(Math.min(0.65, Math.max(0.2, orp + 0.15)) * 100);
    this.focalLine.style.setProperty('--rsvp-focal-x', `${focalXPct}%`);
    this.backdrop.style.setProperty('--rsvp-focal-x', `${focalXPct}%`);
  }

  private updateHighlight(chunk: Chunk): void {
    if (!this.settings.highlightParagraph) return;
    const nextIds = chunk.blockIds.filter(Boolean);
    if (nextIds.length === 0) return;
    if (nextIds.join('|') === this.lastHighlightedBlockIds.join('|')) return;
    this.lastHighlightedBlockIds = nextIds;
    setHighlightedBlocks(nextIds, true);
  }

  private updateStatsPanel(): void {
    const stats = this.engine.getSessionStats();
    const rows: string[] = [];

    if (this.settings.showStats) {
      rows.push(
        metricRow('Words read', stats.wordsRead.toLocaleString()),
        metricRow('Effective WPM', stats.effectiveWpm.toString()),
        metricRow('Pause time', formatDuration(stats.pauseTimeMs)),
        metricRow('Rewinds', stats.rewinds.toString()),
      );
    }

    if (this.settings.speedTrainerEnabled) {
      const progress = this.trainingProgress ?? createEmptyTrainingProgress();
      const challengeStatus = evaluateTrainingSession(progress, stats);
      rows.push(
        trainingCallout(
          challengeStatus.challenge.title,
          challengeStatus.challenge.description,
          challengeStatus.completed
            ? `Challenge complete · +${challengeStatus.challenge.points + 1} pts on close`
            : challengeStatus.progressLabel,
          challengeStatus.completed,
        ),
        metricRow('Training level', `Lv ${getTrainingLevel(progress)}`),
        metricRow('Streak', `${progress.streakDays.toLocaleString()} ${progress.streakDays === 1 ? 'day' : 'days'}`),
        metricRow('Points', progress.totalPoints.toLocaleString()),
      );
    }

    this.statsBody.innerHTML = rows.join('');
  }

  private handleEnded(): void {
    if (this.settings.autoAdvanceChapter && this.chapter.nextChapterUrl) {
      let secondsLeft = this.settings.autoAdvanceDelaySeconds;
      const cancel = () => {
        this.clearAutoAdvance();
        this.showToast('Auto-advance cancelled.', null);
      };
      this.showToast(`Next chapter in ${secondsLeft}s`, 'Cancel', cancel);
      this.autoAdvanceTimer = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft <= 0) {
          this.clearAutoAdvance();
          location.href = this.chapter.nextChapterUrl!;
          return;
        }
        this.showToast(`Next chapter in ${secondsLeft}s`, 'Cancel', cancel);
      }, 1000);
      return;
    }

    this.showToast('Chapter finished.', null);
  }

  private isEditing(): boolean {
    const active = this.shadow?.activeElement as HTMLElement | null;
    return !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (this.isEditing()) return;

    // Block ALL keyboard events from reaching the underlying page while
    // the overlay is active.  This prevents site-specific shortcuts
    // (e.g. RoyalRoad's < / > for chapter navigation) from firing.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const key = event.shiftKey ? `shift+${event.key}` : event.key;

    if (this.isBackAlias(event)) {
      this.handleRewind(() => this.engine?.back());
    } else if (this.isForwardAlias(event)) {
      this.handleNavigation(() => this.engine?.forward());
    } else if (this.matchesShortcut(key, event.key, this.settings.shortcuts.close)) {
      this.close();
    } else if (this.matchesShortcut(key, event.key, this.settings.shortcuts.backSentence)) {
      this.handleRewind(() => this.engine?.backSentence());
    } else if (this.matchesShortcut(key, event.key, this.settings.shortcuts.forwardSentence)) {
      this.handleNavigation(() => this.engine?.forwardSentence());
    } else if (this.matchesShortcut(key, event.key, this.settings.shortcuts.back)) {
      this.handleRewind(() => this.engine?.back());
    } else if (this.matchesShortcut(key, event.key, this.settings.shortcuts.forward)) {
      this.handleNavigation(() => this.engine?.forward());
    } else if (this.matchesShortcut(key, event.key, this.settings.shortcuts.skipBack)) {
      this.handleRewind(() => this.engine?.skipBackSeconds(this.settings.skipBackSeconds));
    } else if (event.key === 'Enter' || this.matchesShortcut(key, event.key, this.settings.shortcuts.playPause)) {
      this.handlePlayPause();
    } else if (this.matchesShortcut(key, event.key, this.settings.shortcuts.speedUp)) {
      this.handleSpeedChange(1);
    } else if (this.matchesShortcut(key, event.key, this.settings.shortcuts.speedDown)) {
      this.handleSpeedChange(-1);
    }
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.scrollDeltaAccum += event.deltaY;
    if (this.scrollDeltaAccum > 60) {
      this.handleSpeedChange(-1);
      this.scrollDeltaAccum = 0;
    } else if (this.scrollDeltaAccum < -60) {
      this.handleSpeedChange(1);
      this.scrollDeltaAccum = 0;
    }
  }

  private handleDisplayClick(event: MouseEvent): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    this.keySink.focus({ preventScroll: true });
    this.handlePlayPause();
  }

  private handleKeyUp(event: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (this.isEditing()) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  private handleKeyPress(event: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (this.isEditing()) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  private handleSpeedChange(direction: 1 | -1): void {
    if (direction > 0) {
      this.recordPersonalization('speed_up');
      this.engine?.speedUp();
    } else {
      this.recordPersonalization('speed_down');
      this.engine?.speedDown();
    }

    const wpm = this.engine?.getWpm() ?? this.settings.wpm;
    this.speedBump.textContent =
      `${wpm} WPM · ${intervalLabel(wpm, this.settings.chunkSize, this.settings.segmentationMode, this.settings.adaptiveChunkSizing)}`;
    this.speedBump.classList.add('visible');
    if (this.speedBumpTimer) clearTimeout(this.speedBumpTimer);
    this.speedBumpTimer = setTimeout(() => this.speedBump.classList.remove('visible'), 1200);
  }

  private handleProgressClick(event: MouseEvent): void {
    this.stopReadAloud();
    const rect = this.progressTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const totalWords = this.engine?.getTotalWords() ?? 0;
    this.engine?.seekToWord(Math.round(ratio * totalWords));
  }

  private emitBookmarkSave(): void {
    const bookmark = this.engine?.getBookmarkSnapshot();
    if (!bookmark) return;
    this.showToast(`Bookmark saved at word ${bookmark.wordIndex.toLocaleString()}`, null);
    window.dispatchEvent(new CustomEvent('rsvp:save-bookmark', { detail: bookmark }));
  }

  private startAutosave(): void {
    this.stopAutosave();
    this.autosaveTimer = setInterval(() => {
      if (!this.isOpen) return;
      const bookmark = this.engine.getBookmarkSnapshot();
      if (bookmark.wordIndex <= 0) return;
      window.dispatchEvent(new CustomEvent('rsvp:save-bookmark', { detail: bookmark }));
    }, AUTOSAVE_INTERVAL_MS);
  }

  private stopAutosave(): void {
    if (this.autosaveTimer) clearInterval(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  private showToast(message: string, actionLabel: string | null, action?: () => void): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = message;
    this.toast.appendChild(label);

    if (actionLabel && action) {
      const button = document.createElement('button');
      button.textContent = actionLabel;
      button.addEventListener('click', () => {
        action();
        this.toast.classList.remove('visible');
      });
      this.toast.appendChild(button);
    }

    this.toast.classList.add('visible');
    this.toastTimer = setTimeout(() => this.toast.classList.remove('visible'), 4000);
  }

  private flashHints(): void {
    this.hints.classList.add('visible');
    this.hintsTimer = setTimeout(() => this.hints.classList.remove('visible'), 4000);
  }

  private matchesShortcut(composedKey: string, rawKey: string, shortcut: string): boolean {
    return composedKey === shortcut || rawKey === shortcut;
  }

  private isBackAlias(event: KeyboardEvent): boolean {
    // Only match Shift+Comma (i.e. '<') — bare comma should not navigate.
    return event.key === '<' || (event.shiftKey && (event.key === ',' || event.code === 'Comma'));
  }

  private isForwardAlias(event: KeyboardEvent): boolean {
    // Only match Shift+Period (i.e. '>') — bare period should not navigate.
    return event.key === '>' || (event.shiftKey && (event.key === '.' || event.code === 'Period'));
  }

  // stopSiteHotkeys is no longer needed — handleKeyDown/KeyUp/KeyPress now
  // unconditionally block all keyboard events while the overlay is open.

  private clearAutoAdvance(): void {
    if (this.autoAdvanceTimer) clearInterval(this.autoAdvanceTimer);
    this.autoAdvanceTimer = null;
  }

  private handlePlayPause(): void {
    if (this.engine?.getPlayState() === 'playing') {
      this.recordPersonalization('pause');
      this.stopReadAloud();
    }
    this.engine?.togglePlay();
  }

  private handleRewind(action: () => void): void {
    this.recordPersonalization('rewind');
    this.stopReadAloud();
    action();
  }

  private handleNavigation(action: () => void): void {
    this.stopReadAloud();
    action();
  }

  handleTtsEvent(event: Extract<ExtMessage, { type: 'TTS_EVENT' }>): void {
    if (event.requestId !== this.ttsActiveRequestId) return;

    if (event.eventType === 'error') {
      this.showToast(`Read aloud error: ${event.errorMessage ?? 'unknown voice error'}`, null);
      this.stopReadAloud();
      return;
    }

    if (['end', 'interrupted', 'cancelled', 'error'].includes(event.eventType)) {
      this.ttsActiveRequestId = 0;
      // For neural TTS the engine never holds — don't call releaseExternalHold
      if (this.settings.ttsProvider !== 'local-neural') {
        this.engine?.releaseExternalHold(true);
      }
    }
  }

  private accumulateSentenceChunk(chunk: Chunk): void {
    // Neural TTS never blocks the engine
    this.engine?.setExternalHold(false);

    // If starting a new sentence, look ahead and request TTS immediately (preload)
    if (this.ttsSentenceBuffer.length === 0) {
      const chunksToSpeak: Chunk[] = [];
      let totalWords = 0;
      let totalVisualMs = 0;
      let currentIndex = chunk.index;
      const wpm = this.engine?.getWpm() ?? this.settings.wpm;

      while (true) {
        const nextChunk = this.engine?.peekChunk(currentIndex);
        if (!nextChunk) break;

        chunksToSpeak.push(nextChunk);
        totalWords += nextChunk.wordCount;
        
        const baseInterval = wpmToInterval(wpm, Math.max(1, nextChunk.wordCount));
        totalVisualMs += chunkDelay(nextChunk, baseInterval, this.settings);

        if (nextChunk.isSentenceEnd || totalWords >= 60) {
          break;
        }
        currentIndex++;
      }

      const utterance = speechTextForSentence(chunksToSpeak);
      if (utterance && totalVisualMs > 0) {
        const effectiveWpm = (totalWords / totalVisualMs) * 60000;
        const rate = neuralSpeechRate(totalWords, effectiveWpm, this.settings.ttsRate);

        this.ttsRequestId += 1;
        this.ttsActiveRequestId = this.ttsRequestId;
        void chrome.runtime.sendMessage({
          type: 'TTS_SPEAK',
          requestId: this.ttsActiveRequestId,
          utterance,
          clientId: this.ttsClientId,
          settings: {
            voiceName: this.settings.ttsVoiceName,
            rate,
            provider: this.settings.ttsProvider,
            localModelId: this.settings.localTtsModelId,
            localVoiceId: this.settings.localTtsVoiceId,
          },
        } satisfies ExtMessage).catch(() => {
          // Fire-and-forget: ignore send errors
        });
      }
    }

    this.ttsSentenceBuffer.push(chunk);

    const wordCount = this.ttsSentenceBuffer.reduce((n, c) => n + c.wordCount, 0);
    const sentenceEnded = chunk.isSentenceEnd;
    const bufferFull = wordCount >= 60;

    // Clear buffer when visually done with this chunk's sentence group,
    // so the NEXT chunk will be treated as the start of a new sentence.
    if (sentenceEnded || bufferFull) {
      this.ttsSentenceBuffer = [];
    }
  }

  private speakCurrentChunk(chunk: Chunk): void {
    if (!this.settings.readAloudEnabled) return;
    const utterance = speechTextForChunk(chunk);
    if (!utterance) return;

    this.ttsRequestId += 1;
    this.ttsActiveRequestId = this.ttsRequestId;
    void chrome.runtime.sendMessage({
      type: 'TTS_SPEAK',
      requestId: this.ttsActiveRequestId,
      utterance,
      clientId: this.ttsClientId,
      settings: {
        voiceName: this.settings.ttsVoiceName,
        rate: effectiveSpeechRate(this.settings.ttsRate, this.engine?.getWpm() ?? this.settings.wpm),
        provider: this.settings.ttsProvider,
        localModelId: this.settings.localTtsModelId,
        localVoiceId: this.settings.localTtsVoiceId,
      },
    } satisfies ExtMessage).catch(() => {
      this.showToast('Read aloud could not start. Falling back to normal playback.', null);
      this.ttsActiveRequestId = 0;
      this.engine?.releaseExternalHold(false);
    });
  }

  private stopReadAloud(): void {
    this.ttsActiveRequestId = 0;
    this.ttsSentenceBuffer = [];
    this.engine?.releaseExternalHold(false);
    void chrome.runtime.sendMessage({ type: 'TTS_STOP' } satisfies ExtMessage).catch(() => {
      // Background may be restarting during a rebuild.
    });
  }

  private async loadPersonalization(): Promise<void> {
    if (!this.settings.personalizationEnabled || !this.settings.personalizationConsentGiven) return;
    const [events, model] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_PERSONALIZATION_EVENTS' }) as Promise<{ ok: boolean; data: PersonalizationEvent[] }>,
      chrome.runtime.sendMessage({ type: 'GET_PERSONALIZATION_MODEL' }) as Promise<{ ok: boolean; data: PersonalizationModel | null }>,
    ]);
    if (events.ok) this.personalizationEvents = events.data;
    if (model.ok) this.personalizationModel = model.data;

    if (this.settings.personalizationEnabled && this.personalizationModel) {
      this.engine.setPersonalizationPredictor(chunk =>
        predictDelayMultiplier(this.personalizationModel!, chunk, this.personalizationContext(chunk)),
      );
    }
  }

  private async loadTrainingProgress(): Promise<void> {
    if (!this.settings.speedTrainerEnabled) return;
    const response = await chrome.runtime.sendMessage({ type: 'GET_TRAINING_PROGRESS' }) as {
      ok: boolean;
      data: ReadingTrainingProgress;
    };
    if (!response.ok) return;
    this.trainingProgress = response.data;
    this.updateStatsPanel();
  }

  private recordPersonalization(action: PersonalizationEvent['action'], chunk = this.lastRenderedChunk): void {
    if (!this.settings.personalizationEnabled || !this.settings.personalizationConsentGiven || !chunk) return;
    this.personalizationEvents.push(
      makeEvent(action, location.href, chunk, this.personalizationContext(chunk)),
    );
  }

  private personalizationContext(chunk: Chunk) {
    const stats = this.engine.getSessionStats();
    const today = new Date().toDateString();
    const wordsReadToday = this.personalizationEvents
      .filter(event => new Date(event.createdAt).toDateString() === today)
      .reduce((sum, event) => Math.max(sum, event.wordIndex), 0);
    const paragraphDensity = chunk.blockIds.length > 0
      ? Math.round(chunk.wordCount / chunk.blockIds.length)
      : chunk.wordCount;
    return {
      baseWpm: this.engine.getWpm(),
      sessionDurationMinutes: stats.activeTimeMs / 60_000,
      wordsReadToday,
      paragraphDensity,
      currentChunkIndex: chunk.index,
    };
  }

  private async flushPersonalization(): Promise<void> {
    if (!this.settings.personalizationEnabled || !this.settings.personalizationConsentGiven) return;

    const stats = this.engine.getSessionStats();
    const wordsSinceTraining = this.settings.personalizationWordsSinceTraining + stats.wordsRead;
    let model = this.personalizationModel;
    let nextSettings: Partial<Settings> = {
      personalizationWordsSinceTraining: wordsSinceTraining,
    };

    if (shouldTrain(wordsSinceTraining) && this.personalizationEvents.length >= 25) {
      model = trainModel(this.personalizationEvents);
      if (model) {
        nextSettings = {
          personalizationWordsSinceTraining: 0,
          personalizationLastTrainedAt: model.trainedAt,
        };
      }
    }

    await Promise.all([
      chrome.runtime.sendMessage({ type: 'SAVE_PERSONALIZATION_EVENTS', events: this.personalizationEvents }),
      chrome.runtime.sendMessage({ type: 'SAVE_PERSONALIZATION_MODEL', model }),
      chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: nextSettings }),
    ]);

    this.personalizationModel = model;
    this.settings = { ...this.settings, ...nextSettings };
  }
}

function el(tag: string, className?: string): HTMLElement {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

function iconBtn(iconHtml: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'rsvp-icon-btn';
  button.innerHTML = iconHtml;
  button.title = title;
  return button;
}

function ctrlBtn(html: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'rsvp-ctrl-btn';
  button.innerHTML = html;
  button.title = title;
  return button;
}

function metricRow(label: string, value: string): string {
  return `<div class="rsvp-session-row"><span>${label}</span><strong>${value}</strong></div>`;
}

function trainingCallout(title: string, description: string, progress: string, completed: boolean): string {
  return `
    <div class="rsvp-training-callout${completed ? ' completed' : ''}">
      <strong>${title}</strong>
      <span>${description}</span>
      <em>${progress}</em>
    </div>
  `;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const normalized = value.length === 3
    ? value.split('').map(char => char + char).join('')
    : value;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * Only allow genuine base64 image data URLs as background images.
 * Rejects empty strings, javascript: URLs, http: URLs, and anything else that
 * could be misused in a CSS url() context.
 */
function isSafeBackgroundImageUrl(value: string): boolean {
  return Boolean(value) && /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(value);
}

function statsToggleLabel(settings: Settings): string {
  if (settings.showStats && settings.speedTrainerEnabled) return 'Session + Training';
  if (settings.speedTrainerEnabled) return 'Training';
  return 'Session stats';
}

function shouldShowStatsPanel(settings: Settings): boolean {
  return settings.showStats || settings.speedTrainerEnabled;
}
