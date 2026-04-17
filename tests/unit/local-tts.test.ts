import {
  DEFAULT_LOCAL_TTS_MODEL_ID,
  DEFAULT_LOCAL_TTS_VOICE_ID,
  formatModelSize,
  getLocalTtsModelInfo,
  getLocalTtsVoice,
  localTtsProgressPercent,
} from '../../src/shared/local-tts';
import type { LocalTtsModelStatus } from '../../src/shared/types';

function status(patch: Partial<LocalTtsModelStatus> = {}): LocalTtsModelStatus {
  return {
    modelId: DEFAULT_LOCAL_TTS_MODEL_ID,
    status: 'downloading',
    downloadedBytes: 0,
    totalBytes: 100,
    updatedAt: 0,
    downloadedAt: null,
    error: null,
    ...patch,
  };
}

describe('local TTS metadata helpers', () => {
  it('exposes the default KittenTTS model metadata', () => {
    const model = getLocalTtsModelInfo();

    expect(model.id).toBe(DEFAULT_LOCAL_TTS_MODEL_ID);
    expect(model.assets.some(asset => asset.name.endsWith('.onnx'))).toBe(true);
    expect(model.voices.length).toBeGreaterThan(1);
  });

  it('falls back to the default voice for unknown local voice ids', () => {
    expect(getLocalTtsVoice(DEFAULT_LOCAL_TTS_MODEL_ID, 'missing').id).toBe(DEFAULT_LOCAL_TTS_VOICE_ID);
  });

  it('formats model sizes for the settings card', () => {
    expect(formatModelSize(24_250_000)).toBe('24 MB');
    expect(formatModelSize(8_020_000)).toBe('8.0 MB');
  });

  it('calculates bounded download progress', () => {
    expect(localTtsProgressPercent(status({ downloadedBytes: 25 }))).toBe(25);
    expect(localTtsProgressPercent(status({ downloadedBytes: 200 }))).toBe(100);
    expect(localTtsProgressPercent(status({ status: 'ready', downloadedBytes: 0 }))).toBe(100);
  });
});
