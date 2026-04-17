import type {
  Bookmark,
  ExtMessage,
  ExtResponse,
  ParsedChapter,
  Settings,
} from '../shared/types';
import { fetchBookmark, persistBookmark } from './bookmark';
import { extractCurrentPage } from './parsers';
import { RSVPOverlay } from './rsvp/overlay';
import { withPreferredReaderUrl } from '../shared/sites';

declare global {
  interface Window {
    __RSVP_READER_INIT__?: boolean;
  }
}

type ContentMessage =
  | ExtMessage
  | { type: 'PING' }
  | { type: 'OPEN_OVERLAY' }
  | { type: 'CLOSE_OVERLAY' }
  | { type: 'SETTINGS_UPDATED' };

let overlay: RSVPOverlay | null = null;
let settings: Settings | null = null;
let observer: MutationObserver | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let activeChapter: ParsedChapter | null = null;
let activeChapterSignature = '';
let activeChapterUrl = location.href;

if (!window.__RSVP_READER_INIT__) {
  window.__RSVP_READER_INIT__ = true;
  init().catch(console.error);
}

async function init(): Promise<void> {
  settings = await fetchSettings();
  activeChapter = extractChapter();
  activeChapterSignature = signatureForChapter(activeChapter);
  activeChapterUrl = location.href;

  chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'OPEN_OVERLAY') {
      openReader().then(() => sendResponse({ ok: true })).catch(error => {
        console.error(error);
        sendResponse({ ok: false });
      });
      return true;
    }

    if (msg.type === 'CLOSE_OVERLAY') {
      overlay?.close();
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'SETTINGS_UPDATED') {
      fetchSettings()
        .then(nextSettings => {
          settings = nextSettings;
          overlay?.updateSettings(nextSettings);
          if (!overlay) {
            activeChapter = extractChapter();
            activeChapterSignature = signatureForChapter(activeChapter);
          }
          sendResponse({ ok: true });
        })
        .catch(error => {
          console.error(error);
          sendResponse({ ok: false });
        });
      return true;
    }

    if (msg.type === 'TTS_EVENT') {
      overlay?.handleTtsEvent(msg);
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  window.addEventListener('rsvp:save-bookmark', event => {
    const detail = (event as CustomEvent<{
      chunkIndex: number;
      wordIndex: number;
      totalChunks: number;
      totalWords: number;
    }>).detail;
    if (!activeChapter) return;
    void saveBookmark(detail, activeChapter);
  });

  document.addEventListener('keydown', event => {
    if (event.altKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      void openReader();
    }
  });

  startObservation();
}

async function openReader(): Promise<void> {
  if (overlay) {
    overlay.close();
    overlay = null;
    return;
  }

  const preferredUrl = withPreferredReaderUrl(location.href);
  if (preferredUrl !== location.href) {
    location.href = preferredUrl;
    return;
  }

  const chapter = extractChapter();
  if (!chapter || !chapter.text) {
    showErrorBanner('RSVP Reader could not extract text from this page.');
    return;
  }

  activeChapter = chapter;
  activeChapterSignature = signatureForChapter(chapter);
  activeChapterUrl = location.href;

  const currentSettings = settings ?? await fetchSettings();
  const bookmark = await fetchBookmark(location.href).catch(() => null);
  const startWordIndex = getResumeWordIndex(bookmark);

  overlay = new RSVPOverlay(currentSettings, chapter);
  overlay.open(
    startWordIndex,
    async (bookmarkSnapshot, stats) => {
      overlay = null;
      await notifyServiceWorker({ type: 'OVERLAY_CLOSED', stats });
      if (bookmarkSnapshot.wordIndex > 0 && activeChapter) {
        await saveBookmark(bookmarkSnapshot, activeChapter);
      }
    },
    () => {
      void chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' } satisfies ExtMessage);
    },
  );

  await notifyServiceWorker({ type: 'OVERLAY_OPENED' });
}

function extractChapter(): ParsedChapter | null {
  const currentSettings = settings;
  return extractCurrentPage({
    includeAuthorNotes: currentSettings?.authorNotesMode === 'include',
    enabledSites: currentSettings?.enabledSites,
    enabledSiteHosts: currentSettings?.enabledSiteHosts,
  });
}

function getResumeWordIndex(bookmark: Bookmark | null): number {
  if (!bookmark || bookmark.wordIndex <= 0 || !activeChapter) return 0;
  const pct = bookmark.totalWords > 0
    ? `${Math.round((bookmark.wordIndex / bookmark.totalWords) * 100)}%`
    : `word ${bookmark.wordIndex.toLocaleString()}`;
  const resume = confirm(
    `RSVP Reader: Resume "${activeChapter.title}" from ${pct} (word ${bookmark.wordIndex.toLocaleString()})?`,
  );
  return resume ? bookmark.wordIndex : 0;
}

async function saveBookmark(
  bookmarkSnapshot: { chunkIndex: number; wordIndex: number; totalChunks: number; totalWords: number },
  chapter: ParsedChapter,
): Promise<void> {
  await persistBookmark({
    version: 2,
    url: location.href,
    chunkIndex: bookmarkSnapshot.chunkIndex,
    wordIndex: bookmarkSnapshot.wordIndex,
    totalChunks: bookmarkSnapshot.totalChunks,
    totalWords: bookmarkSnapshot.totalWords,
    chapterTitle: chapter.title,
    site: chapter.site,
    timestamp: Date.now(),
  });
}

async function fetchSettings(): Promise<Settings> {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }) as ExtResponse<Settings>;
  if (response.ok) return response.data;
  throw new Error(response.error);
}

async function notifyServiceWorker(message: ExtMessage): Promise<void> {
  await chrome.runtime.sendMessage(message).catch(() => {
    // The background may be reloading while the extension rebuilds.
  });
}

function startObservation(): void {
  observer?.disconnect();
  observer = new MutationObserver(() => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const nextChapter = extractChapter();
      const nextSignature = signatureForChapter(nextChapter);
      if (!nextChapter || nextSignature === activeChapterSignature) return;
      const nextChapterUrl = location.href;
      const sameUrl = stripUrlHash(nextChapterUrl) === stripUrlHash(activeChapterUrl);
      const resumeWordIndex = sameUrl ? (overlay?.getBookmarkSnapshot().wordIndex ?? 0) : 0;

      activeChapter = nextChapter;
      activeChapterSignature = nextSignature;
      activeChapterUrl = nextChapterUrl;
      if (overlay) {
        if (!sameUrl || settings?.preferTranslatedText !== false) {
          overlay.replaceChapter(nextChapter, resumeWordIndex);
        }
      }
    }, 500);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function signatureForChapter(chapter: ParsedChapter | null): string {
  if (!chapter) return '';
  return `${location.href}::${chapter.title}::${chapter.text.slice(0, 160)}`;
}

function showErrorBanner(message: string): void {
  const banner = document.createElement('div');
  Object.assign(banner.style, {
    position: 'fixed',
    top: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#c0392b',
    color: '#fff',
    padding: '10px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    zIndex: '2147483647',
    fontFamily: 'system-ui, sans-serif',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    maxWidth: '480px',
    textAlign: 'center',
  });
  banner.textContent = message;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 5000);
}

function stripUrlHash(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return url;
  }
}
