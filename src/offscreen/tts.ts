import {
  DEFAULT_LOCAL_TTS_MODEL_ID,
  DEFAULT_LOCAL_TTS_VOICE_ID,
  getLocalTtsAssetBuffer,
  getLocalTtsModelInfo,
  resolveVoiceAlias,
} from '../shared/local-tts';
import type { ExtMessage, TtsEventType } from '../shared/types';

// ─── Dynamic TTS libs (loaded from IDB at first use) ─────────────────────────

let ttsLibsReady: Promise<void> | null = null;
let ortWasmBlobUrl: string | null = null;

/**
 * Loads ort.wasm.min.js and phonemizer.js from IDB as Blob URLs, then injects
 * them as <script> tags so `ort` and `phonemize` become available on globalThis.
 * Also stores the WASM blob URL for ort.env.wasm.wasmPaths configuration.
 */
async function loadTtsLibs(modelId: string): Promise<void> {
  if (ttsLibsReady) return ttsLibsReady;

  ttsLibsReady = (async () => {
    const [ortJsBuffer, phonemizerBuffer, wasmBuffer] = await Promise.all([
      getLocalTtsAssetBuffer(modelId, 'ort.wasm.min.js'),
      getLocalTtsAssetBuffer(modelId, 'phonemizer.js'),
      getLocalTtsAssetBuffer(modelId, 'ort-wasm-simd-threaded.wasm'),
    ]);

    // Store wasm blob URL for use in ort.env.wasm.wasmPaths
    const wasmBlob = new Blob([wasmBuffer], { type: 'application/wasm' });
    ortWasmBlobUrl = URL.createObjectURL(wasmBlob);

    // Inject scripts sequentially (ORT first, then phonemizer)
    await injectScriptBlob(new Blob([ortJsBuffer], { type: 'application/javascript' }));
    await injectScriptBlob(new Blob([phonemizerBuffer], { type: 'application/javascript' }));
  })();

  return ttsLibsReady;
}

function injectScriptBlob(blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => { URL.revokeObjectURL(url); resolve(); };
    script.onerror = (e) => { URL.revokeObjectURL(url); reject(new Error(`Script injection failed: ${String(e)}`)); };
    document.head.appendChild(script);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ort = (): any => (globalThis as any).ort;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getPhememize = (): ((text: string, lang: string) => Promise<string[]>) => (globalThis as any).phonemize;



// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A parsed NPZ archive entry: a flat Float32Array of voice-embedding data
 * and its shape [rows, cols]. The row index is selected based on token count.
 */
interface NpzEntry {
  data: Float32Array;
  shape: [number, number];
}

type VoiceEmbeddings = Record<string, NpzEntry>;

interface LocalTtsRuntime {
  modelId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
  voices: VoiceEmbeddings;
}

// ─── Module-level state ───────────────────────────────────────────────────────

let runtimePromise: Promise<LocalTtsRuntime> | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
let currentRequest: { requestId: number; tabId: number | null; clientId?: string } | null = null;

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: ExtMessage, _sender, sendResponse) => {
  if (message.type === 'LOCAL_TTS_SPEAK') {
    void speakLocal(message);
    sendResponse({ ok: true, data: null });
    return;
  } else if (message.type === 'LOCAL_TTS_STOP') {
    stopCurrentAudio('cancelled');
    sendResponse({ ok: true, data: null });
  }
});

// ─── Public speak flow ────────────────────────────────────────────────────────

async function speakLocal(message: Extract<ExtMessage, { type: 'LOCAL_TTS_SPEAK' }>): Promise<void> {
  stopCurrentAudio('interrupted');
  currentRequest = {
    requestId: message.requestId,
    tabId: message.tabId,
    clientId: message.clientId,
  };

  try {
    sendLocalEvent(message, 'start');
    const runtime = await getRuntime(message.settings.localModelId || DEFAULT_LOCAL_TTS_MODEL_ID);
    const speed = localSpeechSpeed(message.settings.rate);
    const voiceId = message.settings.localVoiceId || DEFAULT_LOCAL_TTS_VOICE_ID;
    const audio = await synthesize(runtime, message.utterance, voiceId, speed);
    if (!isCurrent(message)) return;

    const blob = encodeWav(audio, getLocalTtsModelInfo(runtime.modelId).sampleRate);
    currentObjectUrl = URL.createObjectURL(blob);
    currentAudio = new Audio(currentObjectUrl);
    currentAudio.onended = () => {
      if (!isCurrent(message)) return;
      cleanupAudio();
      sendLocalEvent(message, 'end');
    };
    currentAudio.onerror = () => {
      cleanupAudio();
      sendLocalEvent(message, 'error', 'Local neural audio playback failed.');
    };
    await currentAudio.play();
  } catch (error) {
    cleanupAudio();
    sendLocalEvent(message, 'error', error instanceof Error ? error.message : String(error));
  }
}

// ─── Runtime loading ──────────────────────────────────────────────────────────

async function getRuntime(modelId: string): Promise<LocalTtsRuntime> {
  if (runtimePromise) {
    const runtime = await runtimePromise;
    if (runtime.modelId === modelId) return runtime;
  }

  runtimePromise = loadRuntime(modelId);
  return await runtimePromise;
}

async function loadRuntime(modelId: string): Promise<LocalTtsRuntime> {
  const model = getLocalTtsModelInfo(modelId);

  // Load ORT JS + phonemizer JS from IDB (downloaded during model download step)
  await loadTtsLibs(modelId);

  const ortGlobal = ort();
  ortGlobal.env.wasm.numThreads = 1;
  // Point ORT at the WASM blob URL we created from IDB during loadTtsLibs
  ortGlobal.env.wasm.wasmPaths = ortWasmBlobUrl ?? '';

  // Derive asset names from the model definition — no hardcoding.
  const onnxAsset = model.assets.find(a => a.name.endsWith('.onnx'));
  const voiceAsset = model.assets.find(a => a.name === 'voices.npz');
  if (!onnxAsset) throw new Error(`Model "${modelId}" has no ONNX asset defined.`);
  if (!voiceAsset) throw new Error(`Model "${modelId}" has no voices.npz asset defined.`);

  const [modelBuffer, voiceBuffer] = await Promise.all([
    getLocalTtsAssetBuffer(model.id, onnxAsset.name),
    getLocalTtsAssetBuffer(model.id, voiceAsset.name),
  ]);

  const voices = await parseNpzVoices(voiceBuffer);

  const session = await ortGlobal.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'basic',
  });

  return { modelId: model.id, session, voices };
}

// ─── Synthesis ────────────────────────────────────────────────────────────────

async function synthesize(
  runtime: LocalTtsRuntime,
  text: string,
  voiceId: string,
  speed: number,
): Promise<Float32Array> {
  const model = getLocalTtsModelInfo(runtime.modelId);

  // Resolve friendly alias (e.g. "Jasper") → internal id (e.g. "expr-voice-2-m")
  const internalVoiceId = resolveVoiceAlias(model, voiceId);

  // Apply per-voice speed prior from config.json before passing to the model
  const adjustedSpeed = speed * (model.speedPriors[internalVoiceId] ?? 1.0);

  const tokenIds = await tokenize(text);
  const speakerEmbedding = selectSpeakerEmbedding(runtime.voices, internalVoiceId, tokenIds.length);
  const inputIds = new BigInt64Array(tokenIds.map(id => BigInt(id)));

  const results = await runtime.session.run({
    input_ids: new (ort().Tensor)('int64', inputIds, [1, inputIds.length]),
    style: new (ort().Tensor)('float32', speakerEmbedding, [1, speakerEmbedding.length]),
    speed: new (ort().Tensor)('float32', new Float32Array([adjustedSpeed]), [1]),
  });

  const waveform = results[runtime.session.outputNames[0]];
  if (!waveform?.data) throw new Error('Local TTS model did not return waveform audio.');

  return normalizeAudio(waveform.data as Float32Array);
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

/**
 * Splits text into phoneme + punctuation segments, phonemizes the word parts,
 * then maps every character through the v0.8 symbol table.
 *
 * Token layout (v0.8): [0, ...symbolIds, 10, 0]
 *   0  = start/end sentinel
 *   10 = sentence newline separator (index of '\n' equivalent in v0.8 table)
 */
async function tokenize(text: string): Promise<number[]> {
  // Split on punctuation groups so we can pass them through unchanged
  const PUNCT_RE = /(\s*[;:,.!?¡¿—…"«»""()\[\]{}]+\s*)+/g;
  const segments: { phonemize: boolean; text: string }[] = [];
  let cursor = 0;

  for (const match of text.matchAll(PUNCT_RE)) {
    if (cursor < match.index!) {
      segments.push({ phonemize: true, text: text.slice(cursor, match.index) });
    }
    segments.push({ phonemize: false, text: match[0] });
    cursor = match.index! + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ phonemize: true, text: text.slice(cursor) });
  }

  // Phonemize word segments, keep punctuation segments as-is
  const processed = await Promise.all(
    segments.map(async seg =>
      seg.phonemize
        ? (await getPhememize()(seg.text, 'en-us')).join(' ')
        : seg.text,
    ),
  );


  // Tokenize the combined phoneme string via the v0.8 symbol table
  const combined = processed.join('');
  const symbolIds: number[] = [];
  for (const char of combined) {
    const id = KITTEN_SYMBOL_TO_ID.get(char);
    if (id !== undefined) symbolIds.push(id);
    // Unknown characters are silently skipped (consistent with reference worker)
  }

  // v0.8 wrapping: prepend 0 (start), append 10 (newline sentinel) + 0 (end)
  return [0, ...symbolIds, 10, 0];
}

// ─── Voice embedding selection ────────────────────────────────────────────────

function selectSpeakerEmbedding(
  voices: VoiceEmbeddings,
  internalVoiceId: string,
  tokenCount: number,
): Float32Array {
  const entry = voices[internalVoiceId];
  if (!entry) throw new Error(`No local TTS voice embedding found for "${internalVoiceId}".`);

  const [rows, cols] = entry.shape;
  const rowIndex = Math.min(Math.max(0, tokenCount - 1), rows - 1);
  return entry.data.slice(rowIndex * cols, (rowIndex + 1) * cols);
}

// ─── NPZ / NPY parsing ────────────────────────────────────────────────────────

/**
 * Parses a `.npz` archive (ZIP of `.npy` files) and returns a map of
 * voice-name → { data: Float32Array; shape: [rows, cols] }.
 */
async function parseNpzVoices(buffer: ArrayBuffer): Promise<VoiceEmbeddings> {
  const entries = await unzipNpz(buffer);
  const voices: VoiceEmbeddings = {};

  for (const [filename, bytes] of entries) {
    if (!filename.endsWith('.npy')) continue;
    const voiceName = filename.replace(/\.npy$/, '');
    const { data, shape } = parseNpy(bytes);
    voices[voiceName] = {
      data,
      shape: [shape[0] ?? 1, shape[1] ?? data.length],
    };
  }

  return voices;
}

/**
 * Reads the ZIP central directory and inflates each entry using the
 * browser-native DecompressionStream ('deflate-raw').
 */
async function unzipNpz(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const result = new Map<string, Uint8Array>();

  // Locate the End of Central Directory (EOCD) record
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('NPZ: could not find End of Central Directory.');

  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);

  // Walk the central directory
  const localHeaders: { fileName: string; localHeaderOffset: number; compressedSize: number; uncompressedSize: number; compressionMethod: number }[] = [];
  let cdOffset = centralDirOffset;
  for (let i = 0; i < entryCount && view.getUint32(cdOffset, true) === 0x02014b50; i++) {
    const compressionMethod = view.getUint16(cdOffset + 10, true);
    const compressedSize = view.getUint32(cdOffset + 20, true);
    const uncompressedSize = view.getUint32(cdOffset + 24, true);
    const fileNameLength = view.getUint16(cdOffset + 28, true);
    const extraLength = view.getUint16(cdOffset + 30, true);
    const commentLength = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);
    const fileName = new TextDecoder().decode(bytes.slice(cdOffset + 46, cdOffset + 46 + fileNameLength));
    localHeaders.push({ fileName, localHeaderOffset, compressedSize, uncompressedSize, compressionMethod });
    cdOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  // Extract each local file entry
  for (const entry of localHeaders) {
    const lhOffset = entry.localHeaderOffset;
    const fileNameLen = view.getUint16(lhOffset + 26, true);
    const extraLen = view.getUint16(lhOffset + 28, true);
    const dataOffset = lhOffset + 30 + fileNameLen + extraLen;

    let entryBytes: Uint8Array;
    if (entry.compressionMethod === 0) {
      // Stored (no compression)
      entryBytes = bytes.slice(dataOffset, dataOffset + entry.uncompressedSize);
    } else if (entry.compressionMethod === 8) {
      // Deflate-raw
      const compressed = bytes.slice(dataOffset, dataOffset + entry.compressedSize);
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      void writer.write(compressed);
      void writer.close();
      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      let totalLen = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLen += value.length;
      }
      entryBytes = new Uint8Array(totalLen);
      let off = 0;
      for (const chunk of chunks) { entryBytes.set(chunk, off); off += chunk.length; }
    } else {
      console.warn(`NPZ: unsupported compression ${entry.compressionMethod} in "${entry.fileName}", skipping.`);
      continue;
    }

    result.set(entry.fileName, entryBytes);
  }

  return result;
}

/**
 * Parses a NumPy `.npy` v1/v2 file and returns a Float32Array plus shape.
 * Supports dtypes float32 (<f4) and float64 (<f8) — float64 is downcast.
 */
function parseNpy(bytes: Uint8Array): { data: Float32Array; shape: number[] } {
  // Magic: \x93NUMPY
  if (bytes[0] !== 0x93 || String.fromCharCode(bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]) !== 'NUMPY') {
    throw new Error('NPY: not a valid .npy file.');
  }
  const majorVersion = bytes[6];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let headerLen: number;
  let dataStart: number;
  if (majorVersion === 1) {
    headerLen = view.getUint16(8, true);
    dataStart = 10 + headerLen;
  } else {
    headerLen = view.getUint32(8, true);
    dataStart = 12 + headerLen;
  }

  const headerText = new TextDecoder().decode(bytes.slice(majorVersion === 1 ? 10 : 12, dataStart));
  const dtypeMatch = headerText.match(/'descr'\s*:\s*'([^']+)'/);
  const shapeMatch = headerText.match(/'shape'\s*:\s*\(([^)]*)\)/);
  if (!dtypeMatch) throw new Error(`NPY: could not parse dtype from header: ${headerText}`);

  const dtype = dtypeMatch[1];
  const shape = shapeMatch
    ? shapeMatch[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    : [];

  const rawBytes = bytes.slice(dataStart);
  const rawBuffer = new ArrayBuffer(rawBytes.length);
  new Uint8Array(rawBuffer).set(rawBytes);

  let data: Float32Array;
  if (dtype === '<f4' || dtype === 'float32') {
    data = new Float32Array(rawBuffer);
  } else if (dtype === '<f8' || dtype === 'float64') {
    const f64 = new Float64Array(rawBuffer);
    data = new Float32Array(f64.length);
    for (let i = 0; i < f64.length; i++) data[i] = f64[i];
  } else {
    throw new Error(`NPY: unsupported dtype "${dtype}".`);
  }

  return { data, shape };
}

// ─── Audio helpers ────────────────────────────────────────────────────────────

function normalizeAudio(audioData: Float32Array): Float32Array {
  const audio = new Float32Array(audioData.length);
  let maxAmplitude = 0;

  for (let index = 0; index < audioData.length; index += 1) {
    const sample = Number.isFinite(audioData[index]) ? audioData[index] : 0;
    audio[index] = Math.max(-1, Math.min(1, sample));
    maxAmplitude = Math.max(maxAmplitude, Math.abs(audio[index]));
  }

  if (maxAmplitude > 0 && maxAmplitude < 0.1) {
    const gain = Math.min(6, 0.45 / maxAmplitude);
    for (let index = 0; index < audio.length; index += 1) {
      audio[index] = Math.max(-1, Math.min(1, audio[index] * gain));
    }
  }

  return trimTrailingSilence(audio);
}

function trimTrailingSilence(audio: Float32Array): Float32Array {
  const maxTrimSamples = Math.min(5_000, Math.floor(audio.length * 0.18));
  if (maxTrimSamples <= 0) return audio;
  let trim = 0;
  for (let index = audio.length - 1; index >= 0 && trim < maxTrimSamples; index -= 1) {
    if (Math.abs(audio[index]) > 0.002) break;
    trim += 1;
  }
  return trim > 0 ? audio.slice(0, audio.length - trim) : audio;
}

function localSpeechSpeed(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.max(0.7, Math.min(1.8, Number(rate.toFixed(2))));
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

// ─── Session management ───────────────────────────────────────────────────────

function stopCurrentAudio(eventType: TtsEventType): void {
  const request = currentRequest;
  cleanupAudio();
  if (!request) return;
  chrome.runtime.sendMessage({
    type: 'LOCAL_TTS_EVENT',
    requestId: request.requestId,
    eventType,
    tabId: request.tabId,
    clientId: request.clientId,
  } satisfies ExtMessage).catch(() => {
    // Background may be restarting during rebuilds.
  });
}

function cleanupAudio(): void {
  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  currentRequest = null;
}

function sendLocalEvent(
  message: Extract<ExtMessage, { type: 'LOCAL_TTS_SPEAK' }>,
  eventType: TtsEventType,
  errorMessage?: string,
): void {
  chrome.runtime.sendMessage({
    type: 'LOCAL_TTS_EVENT',
    requestId: message.requestId,
    eventType,
    tabId: message.tabId,
    errorMessage,
    clientId: message.clientId,
  } satisfies ExtMessage).catch(() => {
    // Background may be restarting during rebuilds.
  });
}

function isCurrent(message: Extract<ExtMessage, { type: 'LOCAL_TTS_SPEAK' }>): boolean {
  return currentRequest?.requestId === message.requestId && currentRequest?.clientId === message.clientId;
}

// ─── v0.8 Symbol table ────────────────────────────────────────────────────────
//
// Derived from the reference worker (huggingworld/offline-kittentts-0.8-webgpu).
// Key fix vs. v0.1: the full A–Z / a–z ASCII block is now included after the
// punctuation symbols. Missing these letters caused espeak phoneme characters
// (which are plain ASCII) to map to ID 0, producing unintelligible audio.

const KITTEN_SYMBOLS: string[] = [
  '$',
  ';',
  ':',
  ',',
  '.',
  '!',
  '?',
  '¡',
  '¿',
  '—',
  '…',
  '"',
  '«',
  '»',
  '\u201c', // "
  '\u201d', // "
  ' ',
  // ── ASCII uppercase A–Z ──
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  // ── ASCII lowercase a–z ──
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  // ── IPA symbols ──
  'ɑ', 'ɐ', 'ɒ', 'æ', 'ɓ', 'ʙ', 'β', 'ɔ', 'ɕ', 'ç', 'ɗ', 'ɖ', 'ð',
  'ʤ', 'ə', 'ɘ', 'ɚ', 'ɛ', 'ɜ', 'ɝ', 'ɞ', 'ɟ', 'ʄ', 'ɡ', 'ɠ', 'ɢ',
  'ʛ', 'ɦ', 'ɧ', 'ħ', 'ɥ', 'ʜ', 'ɨ', 'ɪ', 'ʝ', 'ɭ', 'ɬ', 'ɫ', 'ɮ',
  'ʟ', 'ɱ', 'ɯ', 'ɰ', 'ŋ', 'ɳ', 'ɲ', 'ɴ', 'ø', 'ɵ', 'ɸ', 'θ', 'œ',
  'ɶ', 'ʘ', 'ɹ', 'ɺ', 'ɾ', 'ɻ', 'ʀ', 'ʁ', 'ɽ', 'ʂ', 'ʃ', 'ʈ', 'ʧ',
  'ʉ', 'ʊ', 'ʋ', 'ⱱ', 'ʌ', 'ɣ', 'ɤ', 'ʍ', 'χ', 'ʎ', 'ʏ', 'ʑ', 'ʐ',
  'ʒ', 'ʔ', 'ʡ', 'ʕ', 'ʢ', 'ǀ', 'ǁ', 'ǂ', 'ǃ', 'ˈ', 'ˌ', 'ː', 'ˑ',
  'ʼ', 'ʴ', 'ʰ', 'ʱ', 'ʲ', 'ʷ', 'ˠ', 'ˤ', '˞', '↓', '↑', '→', '↗',
  '↘', '\u0329', 'ᵻ',
];

const KITTEN_SYMBOL_TO_ID = new Map(KITTEN_SYMBOLS.map((symbol, index) => [symbol, index]));
