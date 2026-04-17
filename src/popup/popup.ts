import type { Bookmark, ExtResponse, Settings } from '../shared/types';
import { intervalLabel } from '../content/rsvp/pacing';
import { WPM_MAX, WPM_MIN } from '../shared/constants';
import { fileNameFromUrl, isLocalTextFileUrl } from '../shared/local-text';
import { detectSiteMatchFromUrl, favoriteSiteDefinitions, isSiteEnabledForUrl } from '../shared/sites';

const openBtn = document.getElementById('openBtn') as HTMLButtonElement;
const statusBanner = document.getElementById('statusBanner') as HTMLDivElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;

const speedVal = document.getElementById('speedVal') as HTMLSpanElement;
const speedUp = document.getElementById('speedUp') as HTMLButtonElement;
const speedDown = document.getElementById('speedDown') as HTMLButtonElement;
const chunkVal = document.getElementById('chunkVal') as HTMLSpanElement;
const chunkUp = document.getElementById('chunkUp') as HTMLButtonElement;
const chunkDown = document.getElementById('chunkDown') as HTMLButtonElement;

const togBionic = document.getElementById('togBionic') as HTMLInputElement;
const togFocal = document.getElementById('togFocal') as HTMLInputElement;
const togAdaptive = document.getElementById('togAdaptive') as HTMLInputElement;

const bookmarkRow = document.getElementById('bookmarkRow') as HTMLDivElement;
const bookmarkText = document.getElementById('bookmarkText') as HTMLSpanElement;
const bookmarkDel = document.getElementById('bookmarkDel') as HTMLButtonElement;
const favoritesPanel = document.getElementById('favoritesPanel') as HTMLDivElement;
const favoritesList = document.getElementById('favoritesList') as HTMLDivElement;

const openOptions = document.getElementById('openOptions') as HTMLButtonElement;
const openBookmarks = document.getElementById('openBookmarks') as HTMLButtonElement;

let settings: Settings;
let activeTabId: number | undefined;
let pageUrl = '';

init().catch(console.error);

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  pageUrl = tab?.url ?? '';

  const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }) as ExtResponse<Settings>;
  if (!response.ok) return;
  settings = response.data;
  populateUI();
  await Promise.all([checkPageContent(), loadBookmark()]);
}

function populateUI(): void {
  speedVal.textContent =
    `${settings.wpm} · ${intervalLabel(settings.wpm, settings.chunkSize, settings.segmentationMode, settings.adaptiveChunkSizing)}`;
  chunkVal.textContent = String(settings.chunkSize);
  togBionic.checked = settings.adhdBionic;
  togFocal.checked = settings.adhdFocalPoint;
  togAdaptive.checked = settings.adaptivePacing;
  renderFavorites();
}

async function checkPageContent(): Promise<void> {
  if (!activeTabId) return;
  const isLocalTextFile = isLocalTextFileUrl(pageUrl);
  if (isLocalTextFile) {
    await checkLocalTextFilePage();
    return;
  }

  const currentSiteMatch = detectSiteMatchFromUrl(pageUrl);
  if (currentSiteMatch && !isSiteEnabledForUrl(pageUrl, settings.enabledSites, settings.enabledSiteHosts)) {
    statusBanner.className = 'status-banner warn';
    statusText.textContent = `Support is disabled for ${currentSiteMatch.variant.label} in Settings`;
    openBtn.disabled = true;
    return;
  }
  if (!currentSiteMatch && !settings.enabledSites.includes('generic')) {
    statusBanner.className = 'status-banner warn';
    statusText.textContent = 'Generic fallback is disabled in Settings';
    openBtn.disabled = true;
    return;
  }
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: () => {
        const hasKnownRoot = Boolean(document.querySelector(
          '.chapter-content, .chp_raw, #chp_raw, .cha-words, .part-content, #storytext, .userstuff, .bbWrapper, .wp-block-post-content, .entry-content, .entry-inner, .entrytext, .post-content, .post-body, .storycontent, #chr-content, .chr-c, .r-fulltext, .chapter-body, .reading-content, .reader-content, .prose',
        ));
        const genericRoot = document.querySelector('article, main, [role="main"], .content, #content');
        const plainTextRoot = document.querySelector('body > pre');
        const fallbackText = (
          plainTextRoot?.textContent ??
          (genericRoot as HTMLElement | null)?.innerText ??
          document.body.innerText ??
          document.body.textContent ??
          ''
        );
        const textLength = fallbackText.trim().length;
        return {
          hasKnownRoot,
          textLength,
          title: document.title.slice(0, 60),
        };
      },
    });

    const pageInfo = result ?? { hasKnownRoot: false, textLength: 0, title: '' };

    if (pageInfo.hasKnownRoot) {
      statusBanner.className = 'status-banner ok';
      statusText.textContent = `Supported site ready: ${pageInfo.title}`;
      openBtn.disabled = false;
      return;
    }

    if (pageInfo.textLength > 250) {
      statusBanner.className = 'status-banner ok';
      statusText.textContent = `Generic reader available: ${pageInfo.title}`;
      openBtn.disabled = false;
      return;
    }

    statusBanner.className = 'status-banner warn';
    statusText.textContent = 'No readable chapter text detected';
  } catch {
    statusBanner.className = 'status-banner warn';
    statusText.textContent = 'Cannot access this page';
  }
}

async function checkLocalTextFilePage(): Promise<void> {
  if (!activeTabId) return;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: () => ({ title: document.title.slice(0, 120) }),
    });
    statusBanner.className = 'status-banner ok';
    statusText.textContent = `Local text file ready: ${result?.title?.trim() || fileNameFromUrl(pageUrl)}`;
    openBtn.disabled = false;
  } catch {
    statusBanner.className = 'status-banner warn';
    statusText.textContent = 'Enable "Allow access to file URLs" in the extension details to read local .txt files directly';
    openBtn.disabled = true;
  }
}

async function loadBookmark(): Promise<void> {
  if (!pageUrl) return;
  const response = await chrome.runtime.sendMessage({ type: 'GET_BOOKMARK', url: pageUrl }) as ExtResponse<Bookmark | null>;
  if (!response.ok || !response.data) return;
  const bookmark = response.data;
  const pct = bookmark.totalWords > 0 ? Math.round((bookmark.wordIndex / bookmark.totalWords) * 100) : '?';
  bookmarkText.textContent = `Saved at ${pct}% · word ${bookmark.wordIndex.toLocaleString()}`;
  bookmarkRow.style.display = 'flex';
}

async function patch(delta: Partial<Settings>): Promise<void> {
  settings = {
    ...settings,
    ...delta,
    shortcuts: {
      ...settings.shortcuts,
      ...(delta.shortcuts ?? {}),
    },
  };
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: delta });
  populateUI();
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { type: 'SETTINGS_UPDATED' }).catch(() => {
      // Content script may not be active on this tab yet.
    });
  }
}

openBtn.addEventListener('click', async () => {
  if (!activeTabId) return;
  const response = await chrome.runtime.sendMessage({ type: 'OPEN_READER_ON_TAB', tabId: activeTabId }) as ExtResponse<null>;
  if (!response.ok) {
    statusBanner.className = 'status-banner warn';
    statusText.textContent = response.error;
    return;
  }
  window.close();
});

speedUp.addEventListener('click', async () => {
  const nextWpm = Math.min(WPM_MAX, settings.wpm + settings.wpmStep);
  await patch({ wpm: nextWpm });
});

speedDown.addEventListener('click', async () => {
  const nextWpm = Math.max(WPM_MIN, settings.wpm - settings.wpmStep);
  await patch({ wpm: nextWpm });
});

chunkUp.addEventListener('click', async () => {
  await patch({ chunkSize: Math.min(5, settings.chunkSize + 1) });
});

chunkDown.addEventListener('click', async () => {
  await patch({ chunkSize: Math.max(1, settings.chunkSize - 1) });
});

togBionic.addEventListener('change', () => void patch({ adhdBionic: togBionic.checked }));
togFocal.addEventListener('change', () => void patch({ adhdFocalPoint: togFocal.checked }));
togAdaptive.addEventListener('change', () => void patch({ adaptivePacing: togAdaptive.checked }));

bookmarkDel.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'DELETE_BOOKMARK', url: pageUrl });
  bookmarkRow.style.display = 'none';
});

openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

openBookmarks.addEventListener('click', () => {
  const optionsPage = chrome.runtime.getManifest().options_ui?.page ?? 'src/options/options.html';
  chrome.tabs.create({ url: chrome.runtime.getURL(optionsPage) + '#bookmarks' });
  window.close();
});

function renderFavorites(): void {
  const favorites = favoriteSiteDefinitions(
    settings.favoriteSites.filter(siteId => settings.enabledSites.includes(siteId)),
    settings.enabledSiteHosts,
  );

  if (favorites.length === 0) {
    favoritesPanel.style.display = 'none';
    favoritesList.innerHTML = '';
    return;
  }

  favoritesPanel.style.display = 'block';
  favoritesList.innerHTML = '';
  favorites.forEach(site => {
    if (!site.homeUrl) return;
    const button = document.createElement('button');
    button.className = 'favorite-link';
    button.textContent = site.label;
    button.addEventListener('click', () => {
      chrome.tabs.create({ url: site.homeUrl! });
      window.close();
    });
    favoritesList.appendChild(button);
  });
}
