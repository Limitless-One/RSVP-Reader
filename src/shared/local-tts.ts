import { idbDelete, idbGet, idbSet } from './idb';
import type { LocalTtsModelStatus, LocalTtsVoiceOption } from './types';

export interface LocalTtsModelAsset {
  name: string;
  label: string;
  url: string;
  sizeBytes: number;
  contentType: string;
}

export interface LocalTtsModelInfo {
  id: string;
  name: string;
  shortName: string;
  description: string;
  source: string;
  sourceUrl: string;
  license: string;
  sampleRate: number;
  sizeBytes: number;
  assets: LocalTtsModelAsset[];
  voices: LocalTtsVoiceOption[];
  /** Per internal voice-id speed multiplier from the model's config.json */
  speedPriors: Record<string, number>;
  /** Maps friendly alias (e.g. "Jasper") → internal id (e.g. "expr-voice-2-m") */
  voiceAliases: Record<string, string>;
}

interface StoredLocalTtsAsset {
  name: string;
  contentType: string;
  sizeBytes: number;
  downloadedAt: number;
  buffer: ArrayBuffer;
}

const LOCAL_TTS_STATUS_PREFIX = 'rsvp_local_tts_status_';
const LOCAL_TTS_ASSET_PREFIX = 'rsvp_local_tts_asset_';

/** Model ID for the previous v0.1 model — used only for migration cleanup. */
export const LEGACY_LOCAL_TTS_MODEL_ID = 'kitten-tts-nano-v0.1';

export const DEFAULT_LOCAL_TTS_MODEL_ID = 'kitten-tts-nano-v0.8-int8';
export const DEFAULT_LOCAL_TTS_VOICE_ID = 'Jasper';
export const LOCAL_TTS_DOWNLOAD_ORIGINS = [
  'https://huggingface.co/*',
  'https://*.huggingface.co/*',
  'https://raw.githubusercontent.com/*',
  'https://*.xethub.hf.co/*',
  'https://*.hf.co/*',
  'https://cdn.jsdelivr.net/*',
];

// ─── v0.8 voice list (friendly names matching config.json voice_aliases) ─────

const KITTEN_TTS_V08_VOICES: LocalTtsVoiceOption[] = [
  { id: 'Jasper', name: 'Jasper', description: 'Neutral male' },
  { id: 'Bella',  name: 'Bella',  description: 'Neutral female' },
  { id: 'Bruno',  name: 'Bruno',  description: 'Warm male' },
  { id: 'Luna',   name: 'Luna',   description: 'Warm female' },
  { id: 'Hugo',   name: 'Hugo',   description: 'Bright male' },
  { id: 'Rosie',  name: 'Rosie',  description: 'Bright female' },
  { id: 'Leo',    name: 'Leo',    description: 'Expressive male' },
  { id: 'Kiki',   name: 'Kiki',   description: 'Expressive female' },
];

// ─── Model registry ───────────────────────────────────────────────────────────

export const LOCAL_TTS_MODELS: LocalTtsModelInfo[] = [
  {
    id: DEFAULT_LOCAL_TTS_MODEL_ID,
    name: 'KittenTTS Nano v0.8 (int8)',
    shortName: 'KittenTTS Nano',
    description: 'A small CPU-friendly ONNX voice model (~25 MB) that runs locally in the browser after download.',
    source: 'KittenML',
    sourceUrl: 'https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8',
    license: 'Apache-2.0',
    sampleRate: 24_000,
    sizeBytes: 37_100_000,
    assets: [
      {
        name: 'kitten_tts_nano_v0_8.onnx',
        label: 'ONNX model',
        url: 'https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main/kitten_tts_nano_v0_8.onnx',
        sizeBytes: 25_100_000,
        contentType: 'application/octet-stream',
      },
      {
        name: 'voices.npz',
        label: 'Voice embeddings',
        url: 'https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main/voices.npz',
        sizeBytes: 500_000,
        contentType: 'application/octet-stream',
      },
      {
        // ONNX Runtime WASM backend — replaces the previously bundled public/ort/ files
        name: 'ort-wasm-simd-threaded.wasm',
        label: 'ONNX Runtime WASM',
        url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort-wasm-simd-threaded.wasm',
        sizeBytes: 10_600_000,
        contentType: 'application/wasm',
      },
      {
        // ONNX Runtime JS bundle — loaded dynamically in the offscreen page
        name: 'ort.wasm.min.js',
        label: 'ONNX Runtime JS',
        url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.wasm.min.js',
        sizeBytes: 48_000,
        contentType: 'application/javascript',
      },
      {
        // Phonemizer JS (eSpeak-NG WASM, self-contained) — loaded dynamically in the offscreen page
        name: 'phonemizer.js',
        label: 'Phonemizer JS',
        url: 'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/dist/phonemizer.js',
        sizeBytes: 1_322_000,
        contentType: 'application/javascript',
      },
    ],
    voices: KITTEN_TTS_V08_VOICES,
    // From config.json speed_priors — applied as a multiplier on the user's rate
    speedPriors: {
      'expr-voice-2-f': 0.8,
      'expr-voice-2-m': 0.8,
      'expr-voice-3-m': 0.8,
      'expr-voice-3-f': 0.8,
      'expr-voice-4-m': 0.9,
      'expr-voice-4-f': 0.8,
      'expr-voice-5-m': 0.8,
      'expr-voice-5-f': 0.8,
    },
    // From config.json voice_aliases — maps user-facing name → internal expr-voice-* id
    voiceAliases: {
      Bella:  'expr-voice-2-f',
      Jasper: 'expr-voice-2-m',
      Luna:   'expr-voice-3-f',
      Bruno:  'expr-voice-3-m',
      Rosie:  'expr-voice-4-f',
      Hugo:   'expr-voice-4-m',
      Kiki:   'expr-voice-5-f',
      Leo:    'expr-voice-5-m',
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getLocalTtsModelInfo(modelId = DEFAULT_LOCAL_TTS_MODEL_ID): LocalTtsModelInfo {
  return LOCAL_TTS_MODELS.find(model => model.id === modelId) ?? LOCAL_TTS_MODELS[0];
}

export function getLocalTtsVoice(modelId: string, voiceId: string): LocalTtsVoiceOption {
  const model = getLocalTtsModelInfo(modelId);
  return model.voices.find(voice => voice.id === voiceId) ?? model.voices[0];
}

/**
 * Resolves a friendly voice alias (e.g. "Jasper") to the internal voice id
 * (e.g. "expr-voice-2-m") used for embedding lookup and speed priors. Falls
 * back to the raw id if no alias is found (handles internal ids passed directly).
 */
export function resolveVoiceAlias(model: LocalTtsModelInfo, voiceId: string): string {
  return model.voiceAliases[voiceId] ?? voiceId;
}

export function formatModelSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown size';
  const mb = bytes / 1_000_000;
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

export function localTtsProgressPercent(status: LocalTtsModelStatus): number {
  if (status.status === 'ready') return 100;
  if (status.totalBytes <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((status.downloadedBytes / status.totalBytes) * 100)));
}

export function isLocalTtsReady(status: LocalTtsModelStatus | null | undefined): boolean {
  return status?.status === 'ready';
}

export async function getLocalTtsModelStatus(modelId = DEFAULT_LOCAL_TTS_MODEL_ID): Promise<LocalTtsModelStatus> {
  const model = getLocalTtsModelInfo(modelId);
  const stored = await idbGet<LocalTtsModelStatus>(statusKey(model.id));
  return normalizeLocalTtsStatus(stored, model);
}

export async function downloadLocalTtsModel(
  modelId = DEFAULT_LOCAL_TTS_MODEL_ID,
  onProgress?: (status: LocalTtsModelStatus) => void,
): Promise<LocalTtsModelStatus> {
  const model = getLocalTtsModelInfo(modelId);
  let downloadedBytes = 0;
  const totalBytes = model.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
  let status = createStatus(model.id, 'downloading', downloadedBytes, totalBytes);
  await saveStatus(status);
  onProgress?.(status);

  try {
    for (const asset of model.assets) {
      const buffer = await fetchAsset(asset, bytesRead => {
        status = createStatus(model.id, 'downloading', downloadedBytes + bytesRead, totalBytes);
        onProgress?.(status);
      });
      downloadedBytes += asset.sizeBytes;
      await idbSet(assetKey(model.id, asset.name), {
        name: asset.name,
        contentType: asset.contentType,
        sizeBytes: buffer.byteLength,
        downloadedAt: Date.now(),
        buffer,
      } satisfies StoredLocalTtsAsset);
    }

    status = {
      ...createStatus(model.id, 'ready', totalBytes, totalBytes),
      downloadedAt: Date.now(),
    };
    await saveStatus(status);
    onProgress?.(status);
    return status;
  } catch (error) {
    status = {
      ...createStatus(model.id, 'error', downloadedBytes, totalBytes),
      error: error instanceof Error ? error.message : String(error),
    };
    await saveStatus(status);
    onProgress?.(status);
    throw error;
  }
}

export async function deleteLocalTtsModel(modelId = DEFAULT_LOCAL_TTS_MODEL_ID): Promise<LocalTtsModelStatus> {
  const model = getLocalTtsModelInfo(modelId);
  await Promise.all([
    idbDelete(statusKey(model.id)),
    ...model.assets.map(asset => idbDelete(assetKey(model.id, asset.name))),
  ]);
  return getLocalTtsModelStatus(model.id);
}

/**
 * Purges all IDB entries belonging to the legacy v0.1 model without requiring
 * the old model definition to still exist in LOCAL_TTS_MODELS.
 */
export async function deleteLegacyLocalTtsModel(): Promise<void> {
  const legacyAssetNames = ['kitten_tts_nano_v0_1.onnx', 'voices.json'];
  await Promise.all([
    idbDelete(statusKey(LEGACY_LOCAL_TTS_MODEL_ID)),
    ...legacyAssetNames.map(name => idbDelete(assetKey(LEGACY_LOCAL_TTS_MODEL_ID, name))),
  ]);
}

export async function getLocalTtsAssetBuffer(modelId: string, assetName: string): Promise<ArrayBuffer> {
  const stored = await idbGet<StoredLocalTtsAsset>(assetKey(modelId, assetName));
  if (!stored?.buffer) throw new Error(`Local TTS asset "${assetName}" has not been downloaded.`);
  return stored.buffer.slice(0);
}

export async function getLocalTtsJsonAsset<T>(modelId: string, assetName: string): Promise<T> {
  const buffer = await getLocalTtsAssetBuffer(modelId, assetName);
  const text = new TextDecoder().decode(new Uint8Array(buffer));
  return JSON.parse(text) as T;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function normalizeLocalTtsStatus(
  status: LocalTtsModelStatus | null | undefined,
  model: LocalTtsModelInfo,
): LocalTtsModelStatus {
  if (!status || status.modelId !== model.id) {
    return createStatus(model.id, 'not_downloaded', 0, model.sizeBytes);
  }
  const staleDownloading =
    status.status === 'downloading' && Date.now() - (status.updatedAt ?? 0) > 15 * 60 * 1000;
  return {
    modelId: model.id,
    status: staleDownloading ? 'error' : status.status ?? 'not_downloaded',
    downloadedBytes: Math.max(0, status.downloadedBytes ?? 0),
    totalBytes: Math.max(0, status.totalBytes || model.sizeBytes),
    updatedAt: status.updatedAt ?? Date.now(),
    downloadedAt: status.downloadedAt ?? null,
    error: staleDownloading ? 'Previous download was interrupted.' : status.error ?? null,
  };
}

function createStatus(
  modelId: string,
  status: LocalTtsModelStatus['status'],
  downloadedBytes: number,
  totalBytes: number,
): LocalTtsModelStatus {
  return {
    modelId,
    status,
    downloadedBytes,
    totalBytes,
    updatedAt: Date.now(),
    downloadedAt: null,
    error: null,
  };
}

async function saveStatus(status: LocalTtsModelStatus): Promise<void> {
  await idbSet(statusKey(status.modelId), status);
}

async function fetchAsset(asset: LocalTtsModelAsset, onProgress: (bytesRead: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(asset.url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Could not download ${asset.label}: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress(buffer.byteLength);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(Math.min(received, asset.sizeBytes));
  }

  const combined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

function statusKey(modelId: string): string {
  return `${LOCAL_TTS_STATUS_PREFIX}${modelId}`;
}

function assetKey(modelId: string, assetName: string): string {
  return `${LOCAL_TTS_ASSET_PREFIX}${modelId}_${assetName}`;
}
