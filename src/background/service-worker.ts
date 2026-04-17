import {
  DEFAULT_LOCAL_TTS_MODEL_ID,
  LEGACY_LOCAL_TTS_MODEL_ID,
  deleteLocalTtsModel,
  deleteLegacyLocalTtsModel,
  downloadLocalTtsModel,
  getLocalTtsModelStatus,
  isLocalTtsReady,
} from '../shared/local-tts';
import {
  deleteBookmark,
  exportBundle,
  getAllBookmarks,
  getBookmark,
  getPersonalizationEvents,
  getPersonalizationModel,
  getSettings,
  getTrainingProgress,
  importBundle,
  resetPersonalization,
  resetSettings,
  resetTrainingProgress,
  saveBookmark,
  savePersonalizationEvents,
  savePersonalizationModel,
  saveSettings,
  saveTrainingProgress,
} from '../shared/storage';
import { withPreferredReaderUrl } from '../shared/sites';
import { applyTrainingSession, shouldRecordTrainingSession } from '../shared/training';
import type { ExtMessage, ExtResponse, LocalTtsModelStatus, TtsEventType, TtsSpeakSettings, TtsVoiceOption } from '../shared/types';

interface PendingLocalSpeech {
  requestId: number;
  utterance: string;
  settings: TtsSpeakSettings;
  tabId: number | null;
  clientId?: string;
}

const pendingLocalSpeeches = new Map<string, PendingLocalSpeech>();
let localTtsDownloadPromise: Promise<LocalTtsModelStatus> | null = null;

chrome.runtime.onMessage.addListener((message: ExtMessage, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error: unknown) => {
      const messageText = error instanceof Error ? error.message : String(error);
      sendResponse({ ok: false, error: messageText } satisfies ExtResponse);
    });
  return true;
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  void migrateLegacyLocalTtsSettings();
  if (reason === 'install') {
    const optionsPage = chrome.runtime.getManifest().options_ui?.page;
    if (optionsPage) {
      chrome.tabs.create({ url: chrome.runtime.getURL(optionsPage) });
    }
  }
});

/**
 * One-time migration: if the stored model ID is the v0.1 model, purge its IDB
 * assets (they are incompatible with v0.8) and update the saved setting to the
 * current default.  This is idempotent — subsequent calls do nothing because
 * the stored ID will already be the new value.
 */
async function migrateLegacyLocalTtsSettings(): Promise<void> {
  try {
    const settings = await getSettings();
    if (settings.localTtsModelId === LEGACY_LOCAL_TTS_MODEL_ID) {
      await deleteLegacyLocalTtsModel();
      await saveSettings({
        localTtsModelId: DEFAULT_LOCAL_TTS_MODEL_ID,
        localTtsVoiceId: 'Jasper',
      });
    }
  } catch (error) {
    // Non-fatal: settings may not exist yet on a fresh install.
    console.warn('[RSVP] Local TTS migration error:', error);
  }
}

chrome.commands.onCommand.addListener(command => {
  if (command !== 'toggle-reader') return;
  void withActiveTab(tab => openReaderOnTab(tab.id!));
});

async function handleMessage(msg: ExtMessage, sender: chrome.runtime.MessageSender): Promise<ExtResponse<unknown>> {
  switch (msg.type) {
    case 'GET_SETTINGS':
      return { ok: true, data: await getSettings() };

    case 'SAVE_SETTINGS':
      await saveSettings(msg.settings);
      return { ok: true, data: null };

    case 'RESET_SETTINGS':
      await resetSettings();
      return { ok: true, data: null };

    case 'OPEN_OPTIONS':
      await chrome.runtime.openOptionsPage();
      return { ok: true, data: null };

    case 'OPEN_READER_ON_TAB':
      await openReaderOnTab(msg.tabId);
      return { ok: true, data: null };

    case 'GET_BOOKMARK':
      return { ok: true, data: await getBookmark(msg.url) };

    case 'SAVE_BOOKMARK':
      await saveBookmark(msg.bookmark);
      return { ok: true, data: null };

    case 'DELETE_BOOKMARK':
      await deleteBookmark(msg.url);
      return { ok: true, data: null };

    case 'GET_ALL_BOOKMARKS':
      return { ok: true, data: await getAllBookmarks() };

    case 'EXPORT_BUNDLE':
      return { ok: true, data: await exportBundle() };

    case 'IMPORT_BUNDLE':
      await importBundle(msg.bundle);
      return { ok: true, data: null };

    case 'GET_PERSONALIZATION_EVENTS':
      return { ok: true, data: await getPersonalizationEvents() };

    case 'SAVE_PERSONALIZATION_EVENTS':
      await savePersonalizationEvents(msg.events);
      return { ok: true, data: null };

    case 'GET_PERSONALIZATION_MODEL':
      return { ok: true, data: await getPersonalizationModel() };

    case 'SAVE_PERSONALIZATION_MODEL':
      await savePersonalizationModel(msg.model);
      return { ok: true, data: null };

    case 'RESET_PERSONALIZATION':
      await resetPersonalization();
      return { ok: true, data: null };

    case 'GET_TRAINING_PROGRESS':
      return { ok: true, data: await getTrainingProgress() };

    case 'RESET_TRAINING_PROGRESS':
      await resetTrainingProgress();
      return { ok: true, data: null };

    case 'GET_TTS_VOICES':
      return { ok: true, data: await getTtsVoices() };

    case 'TTS_SPEAK':
      await speakText(msg.requestId, msg.utterance, msg.settings, sender.tab?.id ?? null, msg.clientId);
      return { ok: true, data: null };

    case 'TTS_STOP':
      stopText();
      await sendToOffscreen({ type: 'LOCAL_TTS_STOP' }).catch(() => {
        // Local neural TTS may not have opened an offscreen document yet.
      });
      pendingLocalSpeeches.clear();
      return { ok: true, data: null };

    case 'GET_LOCAL_TTS_MODEL_STATUS':
      return { ok: true, data: await getLocalTtsModelStatus(msg.modelId) };

    case 'DOWNLOAD_LOCAL_TTS_MODEL':
      return { ok: true, data: await startLocalTtsDownload(msg.modelId) };

    case 'DELETE_LOCAL_TTS_MODEL':
      return { ok: true, data: await deleteLocalTtsModel(msg.modelId) };

    case 'LOCAL_TTS_EVENT':
      await handleLocalTtsEvent(msg);
      return { ok: true, data: null };

    case 'OVERLAY_OPENED':
      return { ok: true, data: null };

    case 'OVERLAY_CLOSED':
      if (msg.stats && shouldRecordTrainingSession(msg.stats)) {
        const settings = await getSettings();
        if (settings.speedTrainerEnabled) {
          const progress = await getTrainingProgress();
          await saveTrainingProgress(applyTrainingSession(progress, msg.stats));
        }
      }
      return { ok: true, data: null };

    case 'CHECK_FOR_UPDATES': {
      const isAvailable = await performUpdateCheck();
      return { ok: true, data: isAvailable };
    }

    case 'GET_UPDATE_STATUS': {
      const status = await chrome.storage.local.get(['updateAvailable', 'updateUrl']);
      return { ok: true, data: status };
    }

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

async function performUpdateCheck(): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.enableUpdateChecker) return false;
  
  try {
    const response = await fetch('https://api.github.com/repos/Limitless-One/RSVP-Reader/releases/latest');
    if (!response.ok) return false;
    const release = await response.json();
    const latestVersion = release.tag_name?.replace(/^v/, '');
    const currentVersion = chrome.runtime.getManifest().version;
    
    if (latestVersion && latestVersion !== currentVersion) {
      await chrome.storage.local.set({ updateAvailable: latestVersion, updateUrl: release.html_url });
      void chrome.action.setBadgeText({ text: '!' });
      void chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
      return true;
    }
    
    await chrome.storage.local.remove(['updateAvailable', 'updateUrl']);
    void chrome.action.setBadgeText({ text: '' });
    return false;
  } catch (err) {
    console.error('[RSVP] Update check failed:', err);
    return false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'updateCheck') {
    void performUpdateCheck();
  }
});
chrome.alarms.create('updateCheck', { periodInMinutes: 1440 });

async function getTtsVoices(): Promise<TtsVoiceOption[]> {
  const voices = await chrome.tts.getVoices();
  return voices
    .map(voice => ({
      voiceName: voice.voiceName ?? '',
      lang: voice.lang ?? '',
      remote: Boolean(voice.remote),
      extensionId: voice.extensionId ?? '',
      eventTypes: voice.eventTypes ?? [],
    }))
    .filter(voice => voice.voiceName);
}

async function speakText(
  requestId: number,
  utterance: string,
  settings: TtsSpeakSettings,
  tabId: number | null,
  clientId?: string,
): Promise<void> {
  if (settings.provider === 'local-neural') {
    const modelId = settings.localModelId || DEFAULT_LOCAL_TTS_MODEL_ID;
    const status = await getLocalTtsModelStatus(modelId);
    if (isLocalTtsReady(status)) {
      await speakWithLocalTts(requestId, utterance, settings, tabId, clientId);
      return;
    }
  }

  speakWithChromeTts(requestId, utterance, settings, tabId, clientId);
}

function stopText(): void {
  chrome.tts.stop();
}

function speakWithChromeTts(
  requestId: number,
  utterance: string,
  settings: { voiceName: string; rate: number },
  tabId: number | null,
  clientId?: string,
): void {
  chrome.tts.stop();
  chrome.tts.speak(utterance, {
    enqueue: false,
    rate: settings.rate,
    voiceName: settings.voiceName || undefined,
    onEvent: event => {
      const payload = {
        type: 'TTS_EVENT',
        requestId,
        eventType: event.type as TtsEventType,
        charIndex: event.charIndex,
        errorMessage: event.errorMessage,
        clientId,
      } satisfies ExtMessage;

      if (tabId) {
        void chrome.tabs.sendMessage(tabId, payload).catch(() => {
          // Reader may have closed before the speech event arrives.
        });
        return;
      }

      void chrome.runtime.sendMessage(payload).catch(() => {
        // Reader may have closed before the speech event arrives.
      });
    },
  });
}

async function speakWithLocalTts(
  requestId: number,
  utterance: string,
  settings: TtsSpeakSettings,
  tabId: number | null,
  clientId?: string,
): Promise<void> {
  chrome.tts.stop();
  await ensureOffscreenDocument();
  const pending: PendingLocalSpeech = { requestId, utterance, settings, tabId, clientId };
  pendingLocalSpeeches.set(localSpeechKey(requestId, clientId), pending);
  await sendToOffscreen({
    type: 'LOCAL_TTS_SPEAK',
    requestId,
    utterance,
    settings,
    tabId,
    clientId,
  });
}

async function handleLocalTtsEvent(msg: Extract<ExtMessage, { type: 'LOCAL_TTS_EVENT' }>): Promise<void> {
  const key = localSpeechKey(msg.requestId, msg.clientId);
  const pending = pendingLocalSpeeches.get(key);
  if (msg.eventType === 'error' && pending) {
    pendingLocalSpeeches.delete(key);
    speakWithChromeTts(pending.requestId, pending.utterance, pending.settings, pending.tabId, pending.clientId);
    return;
  }

  if (['end', 'interrupted', 'cancelled', 'error'].includes(msg.eventType)) {
    pendingLocalSpeeches.delete(key);
  }

  const payload = {
    type: 'TTS_EVENT',
    requestId: msg.requestId,
    eventType: msg.eventType,
    charIndex: msg.charIndex,
    errorMessage: msg.errorMessage,
    clientId: msg.clientId,
  } satisfies ExtMessage;

  if (msg.tabId) {
    await chrome.tabs.sendMessage(msg.tabId, payload).catch(() => {
      // Reader may have closed before the local speech event arrives.
    });
    return;
  }

  await chrome.runtime.sendMessage(payload).catch(() => {
    // Reader may have closed before the local speech event arrives.
  });
}

async function startLocalTtsDownload(modelId = DEFAULT_LOCAL_TTS_MODEL_ID): Promise<LocalTtsModelStatus> {
  if (!localTtsDownloadPromise) {
    localTtsDownloadPromise = downloadLocalTtsModel(modelId, broadcastLocalTtsDownloadProgress)
      .finally(() => {
        localTtsDownloadPromise = null;
      });
  }
  return await localTtsDownloadPromise;
}

function broadcastLocalTtsDownloadProgress(status: LocalTtsModelStatus): void {
  void chrome.runtime.sendMessage({
    type: 'LOCAL_TTS_DOWNLOAD_PROGRESS',
    status,
  } satisfies ExtMessage).catch(() => {
    // Options page may not be open while the model downloads.
  });
}

async function ensureOffscreenDocument(): Promise<void> {
  if (!chrome.offscreen) {
    throw new Error('Local neural TTS requires Chrome offscreen documents.');
  }

  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('src/offscreen/tts.html'),
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Generate and play local neural TTS audio for the RSVP reader.',
  });
}

async function sendToOffscreen(message: Extract<ExtMessage, { type: 'LOCAL_TTS_SPEAK' | 'LOCAL_TTS_STOP' }>): Promise<void> {
  await chrome.runtime.sendMessage(message).catch(error => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

function localSpeechKey(requestId: number, clientId?: string): string {
  return `${clientId ?? 'global'}:${requestId}`;
}

async function openReaderOnTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const currentUrl = tab.url ?? '';
  const preferredUrl = currentUrl ? withPreferredReaderUrl(currentUrl) : currentUrl;
  if (preferredUrl && preferredUrl !== currentUrl) {
    await chrome.tabs.update(tabId, { url: preferredUrl });
    await waitForTabComplete(tabId);
  }

  await ensureContentScript(tabId, false, currentUrl);
  await chrome.tabs.sendMessage(tabId, { type: 'OPEN_OVERLAY' }).catch(async () => {
    await ensureContentScript(tabId, true, currentUrl);
    await chrome.tabs.sendMessage(tabId, { type: 'OPEN_OVERLAY' });
  });
}

async function ensureContentScript(tabId: number, force = false, currentUrl = ''): Promise<void> {
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js;
  const file = files?.[0];
  if (!file) throw new Error('No content script entry is available for injection.');
  if (!force) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return;
    } catch {
      // No receiver yet; fall through to injection.
    }
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [file],
    });
  } catch (error) {
    if (currentUrl.startsWith('file:')) {
      throw new Error(
        'To read local .txt files directly, open RSVP Reader in chrome://extensions and enable "Allow access to file URLs".',
      );
    }
    throw error;
  }
}

async function withActiveTab(run: (tab: chrome.tabs.Tab) => Promise<void>): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await run(tab);
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, 15_000);

    const onUpdated = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}
