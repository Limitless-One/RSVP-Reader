import { intervalLabel } from '../content/rsvp/pacing';
import { speechRateLabel } from '../content/rsvp/read-aloud';
import { READABLE_FONTS, THEMES } from '../shared/constants';
import {
  DEFAULT_LOCAL_TTS_MODEL_ID,
  DEFAULT_LOCAL_TTS_VOICE_ID,
  LOCAL_TTS_DOWNLOAD_ORIGINS,
  formatModelSize,
  getLocalTtsModelInfo,
  localTtsProgressPercent,
} from '../shared/local-tts';
import { resolveSiteHomeUrl, SUPPORTED_SITES } from '../shared/sites';
import {
  buildTrainingChallenge,
  formatDurationShort,
  getTrainingLevel,
  normalizeTrainingProgress,
} from '../shared/training';
import { submitFeedback } from '../shared/feedback-api';
import type {
  Bookmark,
  ExportBundle,
  ExtMessage,
  ExtResponse,
  LocalTtsModelStatus,
  PersonalizationEvent,
  PersonalizationModel,
  ReadingTrainingProgress,
  Settings,
  TtsVoiceOption,
  FeedbackPayload,
} from '../shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const $$ = <T extends HTMLElement>(selector: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(selector));

let settings: Settings;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let localTtsStatus: LocalTtsModelStatus | null = null;

init().catch(console.error);

async function init(): Promise<void> {
  settings = await sendMsg<Settings>({ type: 'GET_SETTINGS' });

  initNav();
  initPlayback();
  await initTraining();
  initDisplay();
  initAdhd();
  initSupportedPages();
  initShortcuts();
  void initPersonalization();
  initFeedback();
  initAdvanced();

  $('resetBtn').addEventListener('click', async () => {
    if (!confirm('Reset all settings to defaults?')) return;
    await sendMsg({ type: 'RESET_SETTINGS' });
    location.reload();
  });
}

async function sendMsg<T>(msg: object): Promise<T> {
  const response = await chrome.runtime.sendMessage(msg) as ExtResponse<T>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

async function save(patch: Partial<Settings>): Promise<void> {
  settings = {
    ...settings,
    ...patch,
    shortcuts: {
      ...settings.shortcuts,
      ...(patch.shortcuts ?? {}),
    },
  };
  await sendMsg({ type: 'SAVE_SETTINGS', settings: patch });
  flashSaveBanner();
}

function flashSaveBanner(): void {
  const banner = $('saveBanner');
  banner.classList.add('visible');
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => banner.classList.remove('visible'), 1800);
}

function initNav(): void {
  $$<HTMLAnchorElement>('.nav-link').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      const section = link.dataset['section']!;
      $$('.nav-link').forEach(entry => entry.classList.remove('active'));
      $$('.section').forEach(entry => entry.classList.add('hidden'));
      link.classList.add('active');
      $(`sec-${section}`).classList.remove('hidden');
      history.replaceState(null, '', `#${section}`);
      if (section === 'bookmarks') {
        void loadBookmarks();
      }
      if (section === 'personalization') {
        void refreshPersonalization();
      }
      if (section === 'training') {
        void refreshTraining();
      }
    });
  });

  const hash = location.hash.slice(1);
  if (hash) {
    document.querySelector<HTMLAnchorElement>(`.nav-link[data-section="${hash}"]`)?.click();
  }
}

async function initTraining(): Promise<void> {
  bindToggle('speedTrainerEnabled', value => void save({ speedTrainerEnabled: value }));

  $('resetTraining').addEventListener('click', async () => {
    if (!confirm('Reset all training streaks, levels, and challenge progress?')) return;
    await sendMsg({ type: 'RESET_TRAINING_PROGRESS' });
    await refreshTraining();
  });

  await refreshTraining();
}

async function refreshTraining(): Promise<void> {
  const progress = normalizeTrainingProgress(
    await sendMsg<ReadingTrainingProgress>({ type: 'GET_TRAINING_PROGRESS' }),
  );
  const level = getTrainingLevel(progress);
  const challenge = buildTrainingChallenge(progress);
  const lastSession = progress.lastSessionSummary;

  $('trainingLevel').textContent = String(level);
  $('trainingPoints').textContent = progress.totalPoints.toLocaleString();
  $('trainingStreak').textContent = `${progress.streakDays.toLocaleString()} ${progress.streakDays === 1 ? 'day' : 'days'}`;
  $('trainingSessions').textContent = progress.sessionsCompleted.toLocaleString();
  $('trainingBestWpm').textContent = progress.bestEffectiveWpm.toLocaleString();
  $('trainingFocusWords').textContent = `${progress.bestFocusWords.toLocaleString()} words`;
  $('trainingActiveTime').textContent = formatDurationShort(progress.totalActiveTimeMs);
  $('trainingChallenges').textContent = progress.completedChallenges.toLocaleString();
  $('trainingChallengeTitle').textContent = challenge.title;
  $('trainingChallengeDesc').textContent = challenge.description;
  $('trainingReward').textContent = `+${challenge.points + 1} pts`;
  $('trainingLastSession').textContent = lastSession
    ? formatLastTrainingSession(lastSession)
    : 'No qualifying sessions yet. Read for at least a short focused stretch to start your streak.';
}

function initPlayback(): void {
  const wpmSlider = $<HTMLInputElement>('wpm');
  const wpmVal = $('wpmVal');
  wpmSlider.value = String(settings.wpm);
  syncWpmLabel();
  wpmSlider.addEventListener('input', () => {
    const nextWpm = Number(wpmSlider.value);
    settings = { ...settings, wpm: nextWpm };
    syncWpmLabel();
    void save({ wpm: nextWpm });
  });

  const wpmStep = $<HTMLSelectElement>('wpmStep');
  wpmStep.value = String(settings.wpmStep);
  wpmStep.addEventListener('change', () => {
    void save({ wpmStep: Number(wpmStep.value) });
  });

  const chunkGroup = $('chunkGroup');
  $$<HTMLButtonElement>('.chip', chunkGroup).forEach(chip => {
    chip.classList.toggle('active', Number(chip.dataset['value']) === settings.chunkSize);
    chip.addEventListener('click', () => {
      $$('.chip', chunkGroup).forEach(entry => entry.classList.remove('active'));
      chip.classList.add('active');
      settings = { ...settings, chunkSize: Number(chip.dataset['value']) };
      syncWpmLabel();
      void save({ chunkSize: Number(chip.dataset['value']) });
    });
  });

  const adaptiveChunkSizing = $<HTMLInputElement>('adaptiveChunkSizing');
  adaptiveChunkSizing.checked = settings.adaptiveChunkSizing;
  adaptiveChunkSizing.addEventListener('change', () => {
    settings = {
      ...settings,
      adaptiveChunkSizing: adaptiveChunkSizing.checked,
      segmentationMode: adaptiveChunkSizing.checked
        ? effectiveSegmentationMode(settings.segmentationMode)
        : settings.segmentationMode,
    };
    segmentationMode.value = effectiveSegmentationMode(settings.segmentationMode);
    updateSegmentationState();
    syncWpmLabel();
    void save({
      adaptiveChunkSizing: adaptiveChunkSizing.checked,
      segmentationMode: settings.segmentationMode,
    });
  });

  const readingMode = $<HTMLSelectElement>('readingMode');
  readingMode.value = settings.readingMode;
  readingMode.addEventListener('change', () => {
    void save({ readingMode: readingMode.value as Settings['readingMode'] });
  });

  const readAloudEnabled = $<HTMLInputElement>('readAloudEnabled');
  const ttsProvider = $<HTMLSelectElement>('ttsProvider');
  const ttsProviderHint = $('ttsProviderHint');
  const ttsVoiceName = $<HTMLSelectElement>('ttsVoiceName');
  const ttsRate = $<HTMLInputElement>('ttsRate');
  const ttsRateVal = $('ttsRateVal');
  const localTtsCard = $('localTtsCard');
  const localTtsModelName = $('localTtsModelName');
  const localTtsModelDescription = $('localTtsModelDescription');
  const localTtsStatusPill = $('localTtsStatusPill');
  const localTtsModelSize = $('localTtsModelSize');
  const localTtsModelLicense = $('localTtsModelLicense');
  const localTtsProgressWrap = $('localTtsProgressWrap');
  const localTtsProgressBar = $('localTtsProgressBar');
  const localTtsProgressLabel = $('localTtsProgressLabel');
  const localTtsVoiceId = $<HTMLSelectElement>('localTtsVoiceId');
  const downloadLocalTtsBtn = $<HTMLButtonElement>('downloadLocalTtsBtn');
  const deleteLocalTtsBtn = $<HTMLButtonElement>('deleteLocalTtsBtn');
  const localTtsStatusText = $('localTtsStatusText');
  const localModel = getLocalTtsModelInfo(settings.localTtsModelId || DEFAULT_LOCAL_TTS_MODEL_ID);
  readAloudEnabled.checked = settings.readAloudEnabled;
  ttsProvider.value = settings.ttsProvider;
  ttsRate.value = String(settings.ttsRate);
  ttsRateVal.textContent = speechRateLabel(settings.ttsRate);
  localTtsModelName.textContent = localModel.name;
  localTtsModelDescription.textContent = localModel.description;
  localTtsModelSize.textContent = `~${formatModelSize(localModel.sizeBytes)}`;
  localTtsModelLicense.textContent = localModel.license;
  localTtsVoiceId.innerHTML = '';
  localModel.voices.forEach(voice => {
    const option = document.createElement('option');
    option.value = voice.id;
    option.textContent = `${voice.name} · ${voice.description}`;
    option.selected = voice.id === (settings.localTtsVoiceId || DEFAULT_LOCAL_TTS_VOICE_ID);
    localTtsVoiceId.appendChild(option);
  });
  localTtsVoiceId.value = settings.localTtsVoiceId || DEFAULT_LOCAL_TTS_VOICE_ID;
  readAloudEnabled.addEventListener('change', () => {
    settings = { ...settings, readAloudEnabled: readAloudEnabled.checked };
    updateReadAloudState();
    void save({ readAloudEnabled: readAloudEnabled.checked });
  });
  ttsProvider.addEventListener('change', () => {
    settings = { ...settings, ttsProvider: ttsProvider.value as Settings['ttsProvider'] };
    updateReadAloudState();
    void save({ ttsProvider: settings.ttsProvider });
  });
  ttsVoiceName.addEventListener('change', () => {
    void save({ ttsVoiceName: ttsVoiceName.value });
  });
  localTtsVoiceId.addEventListener('change', () => {
    settings = { ...settings, localTtsVoiceId: localTtsVoiceId.value };
    void save({ localTtsVoiceId: localTtsVoiceId.value });
  });
  ttsRate.addEventListener('input', () => {
    const nextRate = Number(ttsRate.value);
    ttsRateVal.textContent = speechRateLabel(nextRate);
    void save({ ttsRate: nextRate });
  });
  downloadLocalTtsBtn.addEventListener('click', async () => {
    downloadLocalTtsBtn.disabled = true;
    try {
      const canDownload = await ensureLocalTtsDownloadPermission();
      if (!canDownload) throw new Error('Download permission was not granted.');
      localTtsStatus = {
        modelId: localModel.id,
        status: 'downloading',
        downloadedBytes: 0,
        totalBytes: localModel.sizeBytes,
        updatedAt: Date.now(),
        downloadedAt: null,
        error: null,
      };
      renderLocalTtsStatus();
      localTtsStatus = await sendMsg<LocalTtsModelStatus>({ type: 'DOWNLOAD_LOCAL_TTS_MODEL', modelId: localModel.id });
      renderLocalTtsStatus();
      flashSaveBanner();
    } catch (error) {
      localTtsStatus = {
        modelId: localModel.id,
        status: 'error',
        downloadedBytes: 0,
        totalBytes: localModel.sizeBytes,
        updatedAt: Date.now(),
        downloadedAt: null,
        error: error instanceof Error ? error.message : String(error),
      };
      renderLocalTtsStatus();
    }
  });
  deleteLocalTtsBtn.addEventListener('click', async () => {
    if (!confirm('Remove the downloaded local neural TTS model? Chrome TTS will continue to work.')) return;
    localTtsStatus = await sendMsg<LocalTtsModelStatus>({ type: 'DELETE_LOCAL_TTS_MODEL', modelId: localModel.id });
    if (settings.ttsProvider === 'local-neural') {
      settings = { ...settings, ttsProvider: 'chrome' };
      ttsProvider.value = 'chrome';
      await save({ ttsProvider: 'chrome' });
    }
    renderLocalTtsStatus();
  });
  chrome.runtime.onMessage.addListener((message: unknown) => {
    const progress = message as Partial<Extract<ExtMessage, { type: 'LOCAL_TTS_DOWNLOAD_PROGRESS' }>>;
    if (progress.type !== 'LOCAL_TTS_DOWNLOAD_PROGRESS' || !progress.status) return;
    localTtsStatus = progress.status;
    renderLocalTtsStatus();
  });
  updateReadAloudState();
  void loadLocalTtsStatus();
  void loadTtsVoices();

  const segmentationMode = $<HTMLSelectElement>('segmentationMode');
  segmentationMode.value = effectiveSegmentationMode(settings.segmentationMode);
  segmentationMode.addEventListener('change', () => {
    settings = { ...settings, segmentationMode: segmentationMode.value as Settings['segmentationMode'] };
    syncWpmLabel();
    void save({ segmentationMode: settings.segmentationMode });
  });
  updateSegmentationState();

  bindToggle('warmupRamp', value => void save({ warmupRamp: value }));
  bindToggle('adaptivePacing', value => void save({ adaptivePacing: value }));
  bindToggle('sentenceMode', value => void save({ sentenceMode: value }));
  bindToggle('autoAdvanceChapter', value => void save({ autoAdvanceChapter: value }));

  const authorNotesMode = $<HTMLSelectElement>('authorNotesMode');
  authorNotesMode.value = settings.authorNotesMode;
  authorNotesMode.addEventListener('change', () => {
    void save({ authorNotesMode: authorNotesMode.value as Settings['authorNotesMode'] });
  });

  function syncWpmLabel(): void {
    wpmVal.textContent =
      `${settings.wpm} WPM · ${intervalLabel(settings.wpm, settings.chunkSize, effectiveSegmentationMode(settings.segmentationMode), settings.adaptiveChunkSizing)}`;
  }

  function updateSegmentationState(): void {
    segmentationMode.disabled = !settings.adaptiveChunkSizing;
  }

  function updateReadAloudState(): void {
    ttsVoiceName.disabled = !settings.readAloudEnabled;
    ttsRate.disabled = !settings.readAloudEnabled;
    ttsProvider.disabled = !settings.readAloudEnabled;
    localTtsVoiceId.disabled = !settings.readAloudEnabled || settings.ttsProvider !== 'local-neural' || localTtsStatus?.status !== 'ready';
    const localSelected = settings.ttsProvider === 'local-neural';
    localTtsCard.classList.toggle('hidden', !localSelected && localTtsStatus?.status !== 'downloading');
    ttsProviderHint.textContent = localSelected
      ? 'If local neural TTS is unavailable, RSVP Reader automatically falls back to Chrome TTS.'
      : 'Chrome TTS stays as the default and fallback.';
  }

  async function loadLocalTtsStatus(): Promise<void> {
    localTtsStatus = await sendMsg<LocalTtsModelStatus>({
      type: 'GET_LOCAL_TTS_MODEL_STATUS',
      modelId: localModel.id,
    });
    renderLocalTtsStatus();
  }

  function renderLocalTtsStatus(): void {
    const status = localTtsStatus ?? {
      modelId: localModel.id,
      status: 'not_downloaded',
      downloadedBytes: 0,
      totalBytes: localModel.sizeBytes,
      updatedAt: Date.now(),
      downloadedAt: null,
      error: null,
    } satisfies LocalTtsModelStatus;
    const progress = localTtsProgressPercent(status);
    localTtsProgressBar.style.width = `${progress}%`;
    localTtsProgressLabel.textContent = `${progress}%`;
    localTtsProgressWrap.classList.toggle('visible', status.status === 'downloading');
    localTtsStatusPill.className = `status-pill ${status.status === 'not_downloaded' ? '' : status.status}`;
    localTtsStatusPill.textContent = localTtsStatusLabel(status.status);
    downloadLocalTtsBtn.disabled = status.status === 'downloading' || status.status === 'ready';
    deleteLocalTtsBtn.disabled = status.status !== 'ready' && status.status !== 'error';

    if (status.status === 'ready') {
      localTtsStatusText.textContent =
        `Ready. ${localModel.shortName} will run locally, and Chrome TTS remains the fallback.`;
    } else if (status.status === 'downloading') {
      localTtsStatusText.textContent =
        `Downloading ${formatModelSize(status.totalBytes)} of model files. You can keep this page open to watch progress.`;
    } else if (status.status === 'error') {
      localTtsStatusText.textContent =
        `Download failed: ${status.error ?? 'unknown error'}. Chrome TTS will continue to work.`;
    } else {
      localTtsStatusText.textContent =
        'Download the model once to enable local neural TTS. Until then, read aloud uses Chrome TTS.';
    }
    updateReadAloudState();
  }

  async function ensureLocalTtsDownloadPermission(): Promise<boolean> {
    const permissions = { origins: LOCAL_TTS_DOWNLOAD_ORIGINS };
    if (await chrome.permissions.contains(permissions)) return true;
    return await chrome.permissions.request(permissions);
  }

  async function loadTtsVoices(): Promise<void> {
    const voices = await sendMsg<TtsVoiceOption[]>({ type: 'GET_TTS_VOICES' });
    ttsVoiceName.innerHTML = '<option value="">System default</option>';
    voices.forEach(voice => {
      const option = document.createElement('option');
      option.value = voice.voiceName;
      option.textContent = [voice.voiceName, voice.lang, voice.remote ? 'remote' : 'local']
        .filter(Boolean)
        .join(' · ');
      option.selected = voice.voiceName === settings.ttsVoiceName;
      ttsVoiceName.appendChild(option);
    });
    ttsVoiceName.value = settings.ttsVoiceName;
  }

  initPunctuationPauses();
}

function initPunctuationPauses(): void {
  const pauses = settings.punctuationPauses;

  // ── Helpers ──────────────────────────────────────────────────────────────
  const unified   = $<HTMLInputElement>('pauseUnified');
  const unifiedVal = $('pauseUnifiedVal');

  const sliders: { key: keyof typeof pauses; inputId: string; valId: string }[] = [
    { key: 'clause',      inputId: 'pauseClause',      valId: 'pauseClauseVal'      },
    { key: 'sentenceEnd', inputId: 'pauseSentenceEnd', valId: 'pauseSentenceEndVal' },
    { key: 'dash',        inputId: 'pauseDash',        valId: 'pauseDashVal'        },
    { key: 'ellipsis',    inputId: 'pauseEllipsis',    valId: 'pauseEllipsisVal'    },
  ];

  function fmtMult(v: number): string {
    return `${v.toFixed(1)}×`;
  }

  // ── Seed per-type sliders from stored values ─────────────────────────────
  sliders.forEach(({ key, inputId, valId }) => {
    const input = $<HTMLInputElement>(inputId);
    const valEl = $(valId);
    input.value = String(pauses[key]);
    valEl.textContent = fmtMult(pauses[key]);
  });

  // ── Unified slider: average of current per-type values ───────────────────
  const avg = sliders.reduce((sum, { key }) => sum + pauses[key], 0) / sliders.length;
  unified.value = String(Number(avg.toFixed(1)));
  unifiedVal.textContent = fmtMult(Number(unified.value));

  // ── Unified slider moves all four sub-sliders together ───────────────────
  unified.addEventListener('input', () => {
    const v = Number(unified.value);
    unifiedVal.textContent = fmtMult(v);

    // Only update sub-sliders when the details panel is closed (collapsed state)
    const details = $<HTMLDetailsElement>('pauseDetails');
    if (!details.open) {
      sliders.forEach(({ key, inputId, valId }) => {
        const input = $<HTMLInputElement>(inputId);
        input.value = String(v);
        $(valId).textContent = fmtMult(v);
        settings = {
          ...settings,
          punctuationPauses: { ...settings.punctuationPauses, [key]: v },
        };
      });
      void save({ punctuationPauses: settings.punctuationPauses });
    }
  });

  // ── Per-type sliders save individually and sync the unified display ───────
  sliders.forEach(({ key, inputId, valId }) => {
    $<HTMLInputElement>(inputId).addEventListener('input', () => {
      const v = Number($<HTMLInputElement>(inputId).value);
      $(valId).textContent = fmtMult(v);
      settings = {
        ...settings,
        punctuationPauses: { ...settings.punctuationPauses, [key]: v },
      };
      // Mirror the average back to the top-level slider as a visual guide
      const newAvg = sliders.reduce((sum, s) => sum + settings.punctuationPauses[s.key], 0) / sliders.length;
      unified.value = String(Number(newAvg.toFixed(1)));
      unifiedVal.textContent = fmtMult(Number(unified.value));
      void save({ punctuationPauses: settings.punctuationPauses });
    });
  });
}

function localTtsStatusLabel(status: LocalTtsModelStatus['status']): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'downloading':
      return 'Downloading';
    case 'error':
      return 'Needs retry';
    case 'not_downloaded':
    default:
      return 'Not downloaded';
  }
}

function initDisplay(): void {
  const fontSelect = $<HTMLSelectElement>('fontSelect');
  READABLE_FONTS.forEach(font => {
    const option = document.createElement('option');
    option.value = font.value;
    option.textContent = font.label;
    option.style.fontFamily = font.value;
    option.selected = font.value === settings.font;
    fontSelect.appendChild(option);
  });
  fontSelect.style.fontFamily = settings.font;
  fontSelect.addEventListener('change', () => {
    updatePreview({ font: fontSelect.value });
    void save({ font: fontSelect.value });
  });

  const fontSize = $<HTMLInputElement>('fontSize');
  const fontSizeVal = $('fontSizeVal');
  fontSize.value = String(settings.fontSize);
  fontSizeVal.textContent = `${settings.fontSize}px`;
  fontSize.addEventListener('input', () => {
    const value = Number(fontSize.value);
    fontSizeVal.textContent = `${value}px`;
    updatePreview({ fontSize: value });
    void save({ fontSize: value });
  });

  buildThemeGrid();

  const textColor = $<HTMLInputElement>('textColor');
  const bgColor = $<HTMLInputElement>('bgColor');
  const opacity = $<HTMLInputElement>('overlayOpacity');
  const opacityVal = $('opacityVal');
  textColor.value = settings.textColor;
  bgColor.value = settings.backgroundColor;
  opacity.value = String(settings.overlayOpacity);
  opacityVal.textContent = `${Math.round(settings.overlayOpacity * 100)}%`;

  textColor.addEventListener('input', () => {
    updatePreview({ textColor: textColor.value });
    void save({ textColor: textColor.value, theme: 'custom' });
  });
  bgColor.addEventListener('input', () => {
    updatePreview({ backgroundColor: bgColor.value });
    void save({ backgroundColor: bgColor.value, theme: 'custom' });
  });
  opacity.addEventListener('input', () => {
    const value = Number(opacity.value);
    opacityVal.textContent = `${Math.round(value * 100)}%`;
    void save({ overlayOpacity: value });
  });

  const bgImageFile = $<HTMLInputElement>('bgImageFile');
  const bgImageBtn = $('bgImageBtn');
  const bgImageClear = $('bgImageClear');
  const bgImageName = $('bgImageName');
  const bgPreview = $('bgPreview');

  if (settings.backgroundImage) {
    bgPreview.style.backgroundImage = `url(${settings.backgroundImage})`;
    bgPreview.style.display = 'block';
    bgImageClear.style.display = 'inline-block';
    bgImageName.textContent = 'Custom image loaded';
  }

  bgImageBtn.addEventListener('click', () => bgImageFile.click());
  bgImageFile.addEventListener('change', () => {
    const file = bgImageFile.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      bgPreview.style.backgroundImage = `url(${dataUrl})`;
      bgPreview.style.display = 'block';
      bgImageClear.style.display = 'inline-block';
      bgImageName.textContent = file.name;
      updatePreview({ backgroundImage: dataUrl });
      void save({ backgroundImage: dataUrl });
    };
    reader.readAsDataURL(file);
  });
  bgImageClear.addEventListener('click', () => {
    bgPreview.style.display = 'none';
    bgImageClear.style.display = 'none';
    bgImageName.textContent = '';
    bgImageFile.value = '';
    updatePreview({ backgroundImage: '' });
    void save({ backgroundImage: '' });
  });

  updatePreview({});
  bindToggle('peripheralVisionMode', value => void save({ peripheralVisionMode: value }));
}

function buildThemeGrid(): void {
  const grid = $('themeGrid');
  grid.innerHTML = '';
  THEMES.forEach(theme => {
    const swatch = document.createElement('div');
    swatch.className = `theme-swatch${settings.theme === theme.name ? ' active' : ''}`;
    swatch.innerHTML = `
      <div class="theme-swatch-preview" style="background:${theme.backgroundColor};"></div>
      <div class="theme-swatch-label">${theme.label}</div>
    `;
    swatch.addEventListener('click', () => {
      $$('.theme-swatch').forEach(entry => entry.classList.remove('active'));
      swatch.classList.add('active');
      const patch: Partial<Settings> = {
        theme: theme.name,
        backgroundColor: theme.backgroundColor,
        textColor: theme.textColor,
        focalPointColor: theme.focalPointColor,
        font: theme.font,
      };
      settings = { ...settings, ...patch };
      $<HTMLInputElement>('textColor').value = theme.textColor;
      $<HTMLInputElement>('bgColor').value = theme.backgroundColor;
      $<HTMLInputElement>('focalColor').value = theme.focalPointColor;
      updatePreview(patch);
      void save(patch);
    });
    grid.appendChild(swatch);
  });
}

function updatePreview(patch: Partial<Settings>): void {
  const nextSettings = { ...settings, ...patch };
  const box = $('previewBox');
  const word = $('previewWord');
  box.style.background = nextSettings.backgroundImage ? '' : nextSettings.backgroundColor;
  box.style.backgroundImage = nextSettings.backgroundImage ? `url(${nextSettings.backgroundImage})` : '';
  word.style.color = nextSettings.textColor;
  word.style.fontFamily = nextSettings.font;
  word.style.fontSize = `${nextSettings.fontSize}px`;
}

function initAdhd(): void {
  bindToggle('adhdBionic', value => void save({ adhdBionic: value }));
  bindToggle('adhdFocalPoint', value => void save({ adhdFocalPoint: value }));
  bindToggle('showStats', value => void save({ showStats: value }));
  bindToggle('highlightParagraph', value => void save({ highlightParagraph: value }));

  const focalColor = $<HTMLInputElement>('focalColor');
  focalColor.value = settings.focalPointColor;
  focalColor.addEventListener('input', () => {
    void save({ focalPointColor: focalColor.value });
  });
}

function initSupportedPages(): void {
  bindToggle('preferTranslatedText', value => void save({ preferTranslatedText: value }), settings.preferTranslatedText);
  renderSupportedSites();
}

function renderSupportedSites(): void {
  const list = $('supportedSitesList');
  list.innerHTML = '';
  SUPPORTED_SITES.forEach(site => {
    const enabled = settings.enabledSites.includes(site.id);
    const favorite = settings.favoriteSites.includes(site.id);
    const favoriteAllowed = Boolean(resolveSiteHomeUrl(site.id, settings.enabledSiteHosts));
    const enabledVariantCount = site.variants.filter(variant => settings.enabledSiteHosts.includes(variant.id)).length;
    const details = document.createElement('details');
    details.className = 'supported-family';
    details.open = site.id === 'ranobes' || (enabled && enabledVariantCount > 0 && enabledVariantCount < site.variants.length);

    const summary = document.createElement('summary');
    summary.className = 'supported-family-summary';
    summary.innerHTML = `
      <div class="supported-family-meta">
        <div class="supported-family-title">
          <span>${escHtml(site.label)}</span>
          <span class="badge">${escHtml(site.group)}</span>
          ${favoriteAllowed ? '<span class="badge">Quick link</span>' : ''}
        </div>
        <div class="supported-family-desc">${escHtml(site.description)}</div>
      </div>
      <div class="supported-family-actions">
        <button class="favorite-toggle${favorite ? ' active' : ''}" type="button" title="Favorite for quick access" ${favoriteAllowed ? '' : 'disabled'}>★</button>
        <label class="toggle"><input type="checkbox" ${enabled ? 'checked' : ''}><span class="track"><span class="thumb"></span></span></label>
      </div>
    `;
    details.appendChild(summary);

    const summaryActions = summary.querySelector<HTMLElement>('.supported-family-actions')!;
    summaryActions.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
    });

    const favoriteButton = summary.querySelector<HTMLButtonElement>('.favorite-toggle')!;
    favoriteButton.addEventListener('click', () => {
      if (!favoriteAllowed) return;
      const nextFavorites = favorite
        ? settings.favoriteSites.filter(entry => entry !== site.id)
        : [...settings.favoriteSites, site.id];
      settings = { ...settings, favoriteSites: nextFavorites };
      void save({ favoriteSites: nextFavorites }).then(() => renderSupportedSites());
    });

    const enabledToggle = summary.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    enabledToggle.addEventListener('change', () => {
      const nextEnabledSites = enabledToggle.checked
        ? [...new Set([...settings.enabledSites, site.id])]
        : settings.enabledSites.filter(entry => entry !== site.id);
      const nextEnabledSiteHosts = site.id === 'generic'
        ? settings.enabledSiteHosts
        : enabledToggle.checked
          ? [
            ...new Set([
              ...settings.enabledSiteHosts,
              ...site.variants.map(variant => variant.id),
            ]),
          ]
          : settings.enabledSiteHosts.filter(entry => !site.variants.some(variant => variant.id === entry));
      const nextFavorites = enabledToggle.checked
        ? settings.favoriteSites
        : settings.favoriteSites.filter(entry => entry !== site.id);
      settings = {
        ...settings,
        enabledSites: nextEnabledSites,
        enabledSiteHosts: nextEnabledSiteHosts,
        favoriteSites: nextFavorites,
      };
      void save({
        enabledSites: nextEnabledSites,
        enabledSiteHosts: nextEnabledSiteHosts,
        favoriteSites: nextFavorites,
      }).then(() => renderSupportedSites());
    });

    const body = document.createElement('div');
    body.className = 'supported-family-body';

    if (site.id === 'generic') {
      const note = document.createElement('div');
      note.className = 'supported-family-note';
      note.textContent = 'Use this fallback on unknown article pages when there is enough readable text in the DOM.';
      body.appendChild(note);
    } else {
      site.variants.forEach(variant => {
        const variantEnabled = settings.enabledSiteHosts.includes(variant.id);
        const row = document.createElement('article');
        row.className = 'supported-site';
        row.innerHTML = `
          <div class="supported-site-info">
            <div class="supported-site-title">
              <span>${escHtml(variant.label)}</span>
            </div>
            <div class="supported-site-desc">${variant.homeUrl ? escHtml(variant.homeUrl) : 'Supported host variant'}</div>
          </div>
          <div class="supported-site-actions">
            <label class="toggle"><input type="checkbox" ${variantEnabled ? 'checked' : ''}><span class="track"><span class="thumb"></span></span></label>
          </div>
        `;

        const variantToggle = row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        variantToggle.addEventListener('change', () => {
          const nextEnabledSiteHosts = variantToggle.checked
            ? [...new Set([...settings.enabledSiteHosts, variant.id])]
            : settings.enabledSiteHosts.filter(entry => entry !== variant.id);
          const siteHasEnabledVariant = site.variants.some(entry => nextEnabledSiteHosts.includes(entry.id));
          const nextEnabledSites = siteHasEnabledVariant
            ? [...new Set([...settings.enabledSites, site.id])]
            : settings.enabledSites.filter(entry => entry !== site.id);
          const nextFavorites = siteHasEnabledVariant
            ? settings.favoriteSites
            : settings.favoriteSites.filter(entry => entry !== site.id);

          settings = {
            ...settings,
            enabledSites: nextEnabledSites,
            enabledSiteHosts: nextEnabledSiteHosts,
            favoriteSites: nextFavorites,
          };
          void save({
            enabledSites: nextEnabledSites,
            enabledSiteHosts: nextEnabledSiteHosts,
            favoriteSites: nextFavorites,
          }).then(() => renderSupportedSites());
        });

        body.appendChild(row);
      });
    }

    details.appendChild(body);
    list.appendChild(details);
  });
}

const SHORTCUT_LABELS: Record<string, string> = {
  playPause: 'Play / Pause',
  back: 'Go back 1 chunk',
  forward: 'Go forward 1 chunk',
  speedUp: 'Speed up',
  speedDown: 'Speed down',
  close: 'Close reader',
  backSentence: 'Previous sentence',
  forwardSentence: 'Next sentence',
  skipBack: 'Skip back 5 seconds',
};

function initShortcuts(): void {
  const grid = $('shortcutsGrid');
  grid.innerHTML = '';
  Object.entries(settings.shortcuts).forEach(([key, value]) => {
    const item = document.createElement('div');
    item.className = 'shortcut-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'shortcut-name';
    nameSpan.textContent = SHORTCUT_LABELS[key] ?? key;

    const keyBtn = document.createElement('button');
    keyBtn.className = 'shortcut-key';
    keyBtn.dataset['key'] = key;
    keyBtn.textContent = formatKey(value);

    item.append(nameSpan, keyBtn);
    grid.appendChild(item);
  });

  $$<HTMLButtonElement>('.shortcut-key', grid).forEach(button => {
    button.addEventListener('click', () => startRebind(button));
  });
}

function startRebind(button: HTMLButtonElement): void {
  button.textContent = '…press key';
  button.classList.add('listening');

  const handler = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const key = event.shiftKey ? `shift+${event.key}` : event.key;
    if (key === 'Escape') {
      cancelRebind(button, handler);
      return;
    }

    const shortcutKey = button.dataset['key'] as keyof Settings['shortcuts'];
    button.textContent = formatKey(key);
    button.classList.remove('listening');
    document.removeEventListener('keydown', handler, { capture: true });
    void save({ shortcuts: { ...settings.shortcuts, [shortcutKey]: key } });
  };

  document.addEventListener('keydown', handler, { capture: true });
}

function cancelRebind(button: HTMLButtonElement, handler: (event: KeyboardEvent) => void): void {
  button.classList.remove('listening');
  const shortcutKey = button.dataset['key'] as keyof Settings['shortcuts'];
  button.textContent = formatKey(settings.shortcuts[shortcutKey]);
  document.removeEventListener('keydown', handler, { capture: true });
}

function formatKey(key: string): string {
  return key
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .replace('Escape', 'Esc')
    .replace('Backspace', 'Backspace')
    .replace(' ', 'Space')
    .replace('shift+', '⇧+');
}

async function initPersonalization(): Promise<void> {
  bindToggle('personalizationEnabled', value => void save({ personalizationEnabled: value }));
  bindToggle('personalizationConsent', value => {
    void save({ personalizationConsentGiven: value });
  }, settings.personalizationConsentGiven);

  $('exportPersonalization').addEventListener('click', async () => {
    const [events, model] = await Promise.all([
      sendMsg<PersonalizationEvent[]>({ type: 'GET_PERSONALIZATION_EVENTS' }),
      sendMsg<PersonalizationModel | null>({ type: 'GET_PERSONALIZATION_MODEL' }),
    ]);
    downloadBlob(
      new Blob([JSON.stringify({ events, model }, null, 2)], { type: 'application/json' }),
      'rsvp-personalization.json',
    );
  });

  $('resetPersonalization').addEventListener('click', async () => {
    if (!confirm('Delete all stored personalization data and model weights?')) return;
    await sendMsg({ type: 'RESET_PERSONALIZATION' });
    await save({
      personalizationEnabled: false,
      personalizationConsentGiven: false,
      personalizationWordsSinceTraining: 0,
      personalizationLastTrainedAt: null,
    });
    await refreshPersonalization();
  });

  await refreshPersonalization();
}

async function refreshPersonalization(): Promise<void> {
  const [events, model] = await Promise.all([
    sendMsg<PersonalizationEvent[]>({ type: 'GET_PERSONALIZATION_EVENTS' }),
    sendMsg<PersonalizationModel | null>({ type: 'GET_PERSONALIZATION_MODEL' }),
  ]);

  $('personalizationWords').textContent = settings.personalizationWordsSinceTraining.toLocaleString();
  $('personalizationTrainedAt').textContent = settings.personalizationLastTrainedAt
    ? new Date(settings.personalizationLastTrainedAt).toLocaleString()
    : 'Never';
  $('personalizationEvents').textContent = events.length.toLocaleString();
  $('personalizationChart').textContent = events.length === 0
    ? 'No personalization data yet.'
    : `Recent signals: ${events.slice(-12).map(event => event.action).join(' · ')}${model ? ' · model ready' : ''}`;
}

async function loadBookmarks(): Promise<void> {
  const bookmarks = await sendMsg<Bookmark[]>({ type: 'GET_ALL_BOOKMARKS' });
  const list = $('bookmarksList');
  if (bookmarks.length === 0) {
    list.innerHTML = '<div class="empty-state">No bookmarks yet. They are saved automatically while you read and when you close the reader.</div>';
    return;
  }

  list.innerHTML = '';
  const grouped = groupBy(bookmarks, bookmark => bookmark.site);
  Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([site, entries]) => {
      const group = document.createElement('section');
      group.className = 'bookmark-group';
      group.innerHTML = `<h3 class="bookmark-group-title">${escHtml(site)}</h3>`;
      entries.forEach(bookmark => group.appendChild(renderBookmarkCard(bookmark)));
      list.appendChild(group);
    });
}

function renderBookmarkCard(bookmark: Bookmark): HTMLElement {
  const pct = bookmark.totalWords > 0 ? Math.round((bookmark.wordIndex / bookmark.totalWords) * 100) : '?';
  const canOpen = isOpenableBookmarkUrl(bookmark.url);
  const card = document.createElement('div');
  card.className = 'bookmark-card';
  card.innerHTML = `
    <div class="bookmark-info">
      <div class="bookmark-title">${escHtml(bookmark.chapterTitle)}</div>
      <div class="bookmark-meta">${pct}% · word ${bookmark.wordIndex.toLocaleString()} of ${bookmark.totalWords.toLocaleString()}</div>
      <div class="bookmark-meta">${new Date(bookmark.timestamp).toLocaleString()}</div>
    </div>
    <div class="bookmark-actions">
      <button class="bm-btn go-btn"${canOpen ? '' : ' disabled'}>${canOpen ? 'Open' : 'Unavailable'}</button>
      <button class="bm-btn danger del-btn">Delete</button>
    </div>
  `;
  card.querySelector('.go-btn')!.addEventListener('click', () => {
    if (canOpen) {
      chrome.tabs.create({ url: bookmark.url });
    }
  });
  card.querySelector('.del-btn')!.addEventListener('click', async () => {
    await sendMsg({ type: 'DELETE_BOOKMARK', url: bookmark.url });
    void loadBookmarks();
  });
  return card;
}

function initAdvanced(): void {
  const importFile = $<HTMLInputElement>('importFile');

  bindToggle('syncEnabled', value => void save({ syncEnabled: value }));
  bindToggle('enableUpdateChecker', value => void save({ enableUpdateChecker: value }));

  const manualUpdateCheckBtn = $('manualUpdateCheckBtn');
  const updateStatusText = $('updateStatusText');

  manualUpdateCheckBtn.addEventListener('click', async () => {
    manualUpdateCheckBtn.textContent = 'Checking...';
    manualUpdateCheckBtn.disabled = true;
    
    try {
      const isAvailable = await sendMsg<boolean>({ type: 'CHECK_FOR_UPDATES' });
      if (isAvailable) {
        const status = await sendMsg<{updateAvailable?: string, updateUrl?: string}>({ type: 'GET_UPDATE_STATUS' });
        updateStatusText.innerHTML = `Update <strong>v${status.updateAvailable}</strong> is available! <a href="${status.updateUrl}" target="_blank">Download ZIP</a>`;
        updateStatusText.style.display = 'block';
        updateStatusText.style.color = '#38bdf8';
      } else {
        updateStatusText.textContent = 'You are already on the latest version.';
        updateStatusText.style.display = 'block';
        updateStatusText.style.color = '#10b981';
      }
    } catch {
      updateStatusText.textContent = 'Failed to check for updates.';
      updateStatusText.style.display = 'block';
      updateStatusText.style.color = '#ef4444';
    }
    
    manualUpdateCheckBtn.textContent = 'Check Now';
    manualUpdateCheckBtn.disabled = false;
  });

  // Display initial update status if available
  void sendMsg<{updateAvailable?: string, updateUrl?: string}>({ type: 'GET_UPDATE_STATUS' }).then(status => {
    if (status.updateAvailable) {
      updateStatusText.innerHTML = `Update <strong>v${status.updateAvailable}</strong> is available! <a href="${status.updateUrl}" target="_blank">Download ZIP</a>`;
      updateStatusText.style.display = 'block';
      updateStatusText.style.color = '#38bdf8';
    }
  });

  $('exportBundle').addEventListener('click', async () => {
    const bundle = await sendMsg<ExportBundle>({ type: 'EXPORT_BUNDLE' });
    downloadBlob(
      new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
      'rsvp-reader-export.rsvp',
    );
  });

  $('importBundle').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    const file = importFile.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed: unknown = JSON.parse(reader.result as string);
        if (!isValidBundle(parsed)) {
          alert('Invalid bundle file: unrecognized format or version.');
          return;
        }
        await sendMsg({ type: 'IMPORT_BUNDLE', bundle: parsed });
        location.reload();
      } catch {
        alert('Invalid bundle file.');
      }
    };
    reader.readAsText(file);
  });

  chrome.storage.local.getBytesInUse(null, bytes => {
    $('storageUsed').textContent = `${(bytes / 1024).toFixed(1)} KB`;
  });
}

function bindToggle(
  id: string,
  onChange: (value: boolean) => void,
  initialValue?: boolean,
): void {
  const input = $<HTMLInputElement>(id);
  input.checked = initialValue ?? Boolean(settings[id as keyof Settings]);
  input.addEventListener('change', () => onChange(input.checked));
}

function effectiveSegmentationMode(segmentationMode: Settings['segmentationMode']): Exclude<Settings['segmentationMode'], 'fixed'> {
  return segmentationMode === 'fixed' ? 'phrase' : segmentationMode;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Only open browser-safe http/https/file URLs directly. */
function isOpenableBookmarkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'file:';
  } catch {
    return false;
  }
}

/** Structural validation for imported bundles — rejects malformed or tampered files. */
function isValidBundle(value: unknown): value is ExportBundle {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (obj['version'] !== 1) return false;
  if (typeof obj['settings'] !== 'object' || obj['settings'] === null) return false;
  if (!Array.isArray(obj['bookmarks'])) return false;
  if (typeof obj['personalization'] !== 'object' || obj['personalization'] === null) return false;
  const p = obj['personalization'] as Record<string, unknown>;
  if (!Array.isArray(p['events'])) return false;
  return true;
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const key = getKey(item);
    groups[key] ??= [];
    groups[key].push(item);
    return groups;
  }, {});
}

function formatLastTrainingSession(summary: NonNullable<ReadingTrainingProgress['lastSessionSummary']>): string {
  const outcome = summary.challengeCompleted ? 'cleared' : 'attempted';
  return [
    `${new Date(summary.completedAt).toLocaleString()} · ${summary.wordsRead.toLocaleString()} words in ${formatDurationShort(summary.activeTimeMs)} at ${summary.effectiveWpm.toLocaleString()} WPM.`,
    `${outcome === 'cleared' ? 'Challenge cleared' : 'Challenge attempted'}: ${summary.challengeTitle}.`,
    `Rewinds ${summary.rewinds}, pauses ${summary.pauses}, points earned ${summary.pointsEarned}.`,
  ].join(' ');
}

function initFeedback(): void {
  bindToggle('showFeedbackWidget', value => void save({ showFeedbackWidget: value }));

  const typeSelect = $<HTMLSelectElement>('optionFeedbackType');
  const msgInput = $<HTMLTextAreaElement>('optionFeedbackMsg');
  const statusSpan = $('optionFeedbackStatus');
  const submitBtn = $<HTMLButtonElement>('optionFeedbackBtn');
  const ratingGroup = $('optionFeedbackRating');

  $$<HTMLButtonElement>('.chip', ratingGroup).forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.chip', ratingGroup).forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  submitBtn.addEventListener('click', async () => {
    const message = msgInput.value.trim();
    if (!message) {
      statusSpan.textContent = 'Please enter a message.';
      statusSpan.style.color = '#ef4444';
      return;
    }

    const type = typeSelect.value as FeedbackPayload['type'];
    const activeRating = ratingGroup.querySelector('.chip.active') as HTMLElement;
    const rating = activeRating ? activeRating.dataset['value'] as FeedbackPayload['rating'] : undefined;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    try {
      await submitFeedback({ type, rating, message });
      statusSpan.textContent = 'Thank you for your feedback!';
      statusSpan.style.color = 'var(--rsvp-focal-color, #fb923c)';
      msgInput.value = '';
    } catch (err: any) {
      statusSpan.textContent = `Error: ${err.message}`;
      statusSpan.style.color = '#ef4444';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Anonymous Feedback';
      setTimeout(() => {
        statusSpan.textContent = '';
      }, 5000);
    }
  });
}
