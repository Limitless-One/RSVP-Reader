import type { Bookmark, ExtMessage, ExtResponse } from '../shared/types';

/** Send a typed message to the service worker and return the response data */
async function send<T>(msg: ExtMessage): Promise<T> {
  const resp = await chrome.runtime.sendMessage(msg) as ExtResponse<T>;
  if (!resp.ok) throw new Error(resp.error);
  return resp.data as T;
}

export async function fetchBookmark(url: string): Promise<Bookmark | null> {
  return send<Bookmark | null>({ type: 'GET_BOOKMARK', url });
}

export async function persistBookmark(bookmark: Bookmark): Promise<void> {
  await send({ type: 'SAVE_BOOKMARK', bookmark });
}

export async function removeBookmark(url: string): Promise<void> {
  await send({ type: 'DELETE_BOOKMARK', url });
}
