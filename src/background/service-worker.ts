import {
  deleteBookmark,
  exportBundle,
  getAllBookmarks,
  getBookmark,
  getPersonalizationEvents,
  getPersonalizationModel,
  getSettings,
  importBundle,
  resetPersonalization,
  resetSettings,
  saveBookmark,
  savePersonalizationEvents,
  savePersonalizationModel,
  saveSettings,
} from '../shared/storage';
import { withPreferredReaderUrl } from '../shared/sites';
import type { ExtMessage, ExtResponse } from '../shared/types';

chrome.runtime.onMessage.addListener((message: ExtMessage, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      const messageText = error instanceof Error ? error.message : String(error);
      sendResponse({ ok: false, error: messageText } satisfies ExtResponse);
    });
  return true;
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    const optionsPage = chrome.runtime.getManifest().options_ui?.page;
    if (optionsPage) {
      chrome.tabs.create({ url: chrome.runtime.getURL(optionsPage) });
    }
  }
});

chrome.commands.onCommand.addListener(command => {
  if (command !== 'toggle-reader') return;
  void withActiveTab(tab => openReaderOnTab(tab.id!));
});

async function handleMessage(msg: ExtMessage): Promise<ExtResponse<unknown>> {
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

    case 'OVERLAY_OPENED':
    case 'OVERLAY_CLOSED':
      return { ok: true, data: null };

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

async function openReaderOnTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const currentUrl = tab.url ?? '';
  const preferredUrl = currentUrl ? withPreferredReaderUrl(currentUrl) : currentUrl;
  if (preferredUrl && preferredUrl !== currentUrl) {
    await chrome.tabs.update(tabId, { url: preferredUrl });
    await waitForTabComplete(tabId);
  }

  await ensureContentScript(tabId);
  await chrome.tabs.sendMessage(tabId, { type: 'OPEN_OVERLAY' }).catch(async () => {
    await ensureContentScript(tabId, true);
    await chrome.tabs.sendMessage(tabId, { type: 'OPEN_OVERLAY' });
  });
}

async function ensureContentScript(tabId: number, force = false): Promise<void> {
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
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [file],
  });
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
