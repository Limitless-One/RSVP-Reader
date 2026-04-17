import type { ReadingStats, ReadingTrainingProgress, TrainingSessionSummary } from './types';

export type TrainingChallengeKind = 'distance' | 'focus' | 'pace';

export interface TrainingChallenge {
  kind: TrainingChallengeKind;
  title: string;
  description: string;
  points: number;
  targetWords?: number;
  maxRewinds?: number;
  targetActiveTimeMs?: number;
  minEffectiveWpm?: number;
}

export interface TrainingChallengeStatus {
  challenge: TrainingChallenge;
  completed: boolean;
  completionRatio: number;
  progressLabel: string;
  level: number;
}

const MIN_QUALIFYING_WORDS = 80;
const MIN_QUALIFYING_ACTIVE_MS = 45_000;
const LEVEL_POINT_STEP = 4;

export function createEmptyTrainingProgress(): ReadingTrainingProgress {
  return {
    sessionsCompleted: 0,
    totalWordsRead: 0,
    totalActiveTimeMs: 0,
    streakDays: 0,
    lastSessionDay: null,
    lastSessionAt: null,
    bestEffectiveWpm: 0,
    bestWordsRead: 0,
    bestFocusWords: 0,
    completedChallenges: 0,
    totalPoints: 0,
    lastSessionSummary: null,
  };
}

export function normalizeTrainingProgress(
  value?: Partial<ReadingTrainingProgress> | null,
): ReadingTrainingProgress {
  const base = createEmptyTrainingProgress();
  if (!value) return base;
  return {
    ...base,
    ...value,
    lastSessionSummary: normalizeTrainingSessionSummary(value.lastSessionSummary),
  };
}

export function getTrainingLevel(progress: ReadingTrainingProgress): number {
  return 1 + Math.floor(progress.totalPoints / LEVEL_POINT_STEP);
}

export function buildTrainingChallenge(progress: ReadingTrainingProgress): TrainingChallenge {
  const level = getTrainingLevel(progress);
  const cycle = progress.sessionsCompleted % 3;

  if (cycle === 0) {
    const targetWords = 250 + (level - 1) * 100;
    return {
      kind: 'distance',
      title: 'Distance Builder',
      description: `Read ${targetWords.toLocaleString()} words in this session.`,
      targetWords,
      points: 2,
    };
  }

  if (cycle === 1) {
    const targetWords = 180 + (level - 1) * 70;
    const maxRewinds = level >= 4 ? 2 : 1;
    return {
      kind: 'focus',
      title: 'Steady Focus',
      description: `Read ${targetWords.toLocaleString()} words with at most ${maxRewinds} rewind${maxRewinds === 1 ? '' : 's'}.`,
      targetWords,
      maxRewinds,
      points: 2,
    };
  }

  const targetActiveTimeMs = (2 + Math.min(4, Math.floor((level - 1) / 2))) * 60_000;
  const bestBaseline = progress.bestEffectiveWpm > 0 ? progress.bestEffectiveWpm : 240;
  const minEffectiveWpm = roundToNearestTen(clamp(bestBaseline * 0.92, 200, 900));
  return {
    kind: 'pace',
    title: 'Speed Hold',
    description: `Stay above ${minEffectiveWpm.toLocaleString()} effective WPM for ${formatMinutes(targetActiveTimeMs)} minutes of active reading.`,
    targetActiveTimeMs,
    minEffectiveWpm,
    points: 3,
  };
}

export function evaluateTrainingSession(
  progress: ReadingTrainingProgress,
  stats: ReadingStats,
): TrainingChallengeStatus {
  const challenge = buildTrainingChallenge(progress);
  const level = getTrainingLevel(progress);

  if (challenge.kind === 'distance') {
    const wordsRead = stats.wordsRead;
    const targetWords = challenge.targetWords ?? 1;
    return {
      challenge,
      completed: wordsRead >= targetWords,
      completionRatio: clamp(wordsRead / targetWords, 0, 1),
      progressLabel: `${wordsRead.toLocaleString()} / ${targetWords.toLocaleString()} words`,
      level,
    };
  }

  if (challenge.kind === 'focus') {
    const wordsRead = stats.wordsRead;
    const targetWords = challenge.targetWords ?? 1;
    const maxRewinds = challenge.maxRewinds ?? 1;
    const rewindsOk = stats.rewinds <= maxRewinds;
    return {
      challenge,
      completed: wordsRead >= targetWords && rewindsOk,
      completionRatio: clamp(wordsRead / targetWords, 0, 1),
      progressLabel: `${wordsRead.toLocaleString()} / ${targetWords.toLocaleString()} words · ${stats.rewinds}/${maxRewinds} rewinds`,
      level,
    };
  }

  const targetActiveTimeMs = challenge.targetActiveTimeMs ?? 60_000;
  const minEffectiveWpm = challenge.minEffectiveWpm ?? 200;
  const timeRatio = clamp(stats.activeTimeMs / targetActiveTimeMs, 0, 1);
  return {
    challenge,
    completed: stats.activeTimeMs >= targetActiveTimeMs && stats.effectiveWpm >= minEffectiveWpm,
    completionRatio: timeRatio,
    progressLabel: `${formatDurationShort(stats.activeTimeMs)} / ${formatDurationShort(targetActiveTimeMs)} · ${stats.effectiveWpm.toLocaleString()} WPM`,
    level,
  };
}

export function shouldRecordTrainingSession(stats: ReadingStats): boolean {
  return stats.wordsRead >= MIN_QUALIFYING_WORDS && stats.activeTimeMs >= MIN_QUALIFYING_ACTIVE_MS;
}

export function applyTrainingSession(
  currentProgress: ReadingTrainingProgress,
  stats: ReadingStats,
): ReadingTrainingProgress {
  const progress = normalizeTrainingProgress(currentProgress);
  if (!shouldRecordTrainingSession(stats)) return progress;

  const challengeStatus = evaluateTrainingSession(progress, stats);
  const completedAt = stats.sessionStartTs + stats.activeTimeMs + stats.pauseTimeMs;
  const sessionDay = localDayKey(completedAt);
  const pointsEarned = 1 + (challengeStatus.completed ? challengeStatus.challenge.points : 0);

  return {
    sessionsCompleted: progress.sessionsCompleted + 1,
    totalWordsRead: progress.totalWordsRead + stats.wordsRead,
    totalActiveTimeMs: progress.totalActiveTimeMs + stats.activeTimeMs,
    streakDays: nextStreakDays(progress, sessionDay),
    lastSessionDay: sessionDay,
    lastSessionAt: completedAt,
    bestEffectiveWpm: Math.max(progress.bestEffectiveWpm, stats.effectiveWpm),
    bestWordsRead: Math.max(progress.bestWordsRead, stats.wordsRead),
    bestFocusWords: stats.rewinds === 0 ? Math.max(progress.bestFocusWords, stats.wordsRead) : progress.bestFocusWords,
    completedChallenges: progress.completedChallenges + (challengeStatus.completed ? 1 : 0),
    totalPoints: progress.totalPoints + pointsEarned,
    lastSessionSummary: {
      completedAt,
      wordsRead: stats.wordsRead,
      activeTimeMs: stats.activeTimeMs,
      effectiveWpm: stats.effectiveWpm,
      rewinds: stats.rewinds,
      pauses: stats.pauses,
      challengeTitle: challengeStatus.challenge.title,
      challengeCompleted: challengeStatus.completed,
      pointsEarned,
    },
  };
}

function normalizeTrainingSessionSummary(
  value: TrainingSessionSummary | null | undefined,
): TrainingSessionSummary | null {
  if (!value) return null;
  return {
    completedAt: value.completedAt ?? 0,
    wordsRead: value.wordsRead ?? 0,
    activeTimeMs: value.activeTimeMs ?? 0,
    effectiveWpm: value.effectiveWpm ?? 0,
    rewinds: value.rewinds ?? 0,
    pauses: value.pauses ?? 0,
    challengeTitle: value.challengeTitle ?? '',
    challengeCompleted: Boolean(value.challengeCompleted),
    pointsEarned: value.pointsEarned ?? 0,
  };
}

function nextStreakDays(progress: ReadingTrainingProgress, sessionDay: string): number {
  if (!progress.lastSessionDay) return 1;
  const diff = dayDiff(progress.lastSessionDay, sessionDay);
  if (diff <= 0) return Math.max(progress.streakDays, 1);
  if (diff === 1) return progress.streakDays + 1;
  return 1;
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayDiff(previousDay: string, nextDay: string): number {
  const previous = new Date(`${previousDay}T00:00:00`);
  const next = new Date(`${nextDay}T00:00:00`);
  return Math.round((next.getTime() - previous.getTime()) / 86_400_000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToNearestTen(value: number): number {
  return Math.round(value / 10) * 10;
}

export function formatDurationShort(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatMinutes(ms: number): number {
  return Math.round(ms / 60_000);
}
