import {
  applyTrainingSession,
  buildTrainingChallenge,
  createEmptyTrainingProgress,
  evaluateTrainingSession,
  getTrainingLevel,
  shouldRecordTrainingSession,
} from '../../src/shared/training';

describe('training helpers', () => {
  it('starts with a simple distance challenge', () => {
    const progress = createEmptyTrainingProgress();
    const challenge = buildTrainingChallenge(progress);

    expect(challenge.kind).toBe('distance');
    expect(challenge.targetWords).toBe(250);
  });

  it('cycles toward a focus challenge after one qualifying session', () => {
    const updated = applyTrainingSession(createEmptyTrainingProgress(), {
      wordsRead: 280,
      activeTimeMs: 90_000,
      pauseTimeMs: 0,
      pauses: 0,
      rewinds: 0,
      sessionStartTs: new Date('2026-04-10T08:00:00').getTime(),
      effectiveWpm: 310,
    });

    const challenge = buildTrainingChallenge(updated);
    expect(challenge.kind).toBe('focus');
    expect(updated.completedChallenges).toBe(1);
    expect(updated.totalPoints).toBe(3);
  });

  it('does not record tiny accidental sessions', () => {
    expect(shouldRecordTrainingSession({
      wordsRead: 40,
      activeTimeMs: 20_000,
      pauseTimeMs: 0,
      pauses: 0,
      rewinds: 0,
      sessionStartTs: 1,
      effectiveWpm: 120,
    })).toBe(false);
  });

  it('evaluates pace challenges using both time and effective speed', () => {
    const seeded = {
      ...createEmptyTrainingProgress(),
      sessionsCompleted: 2,
      totalPoints: 6,
      bestEffectiveWpm: 320,
    };

    const status = evaluateTrainingSession(seeded, {
      wordsRead: 620,
      activeTimeMs: 125_000,
      pauseTimeMs: 20_000,
      pauses: 1,
      rewinds: 0,
      sessionStartTs: 1,
      effectiveWpm: 300,
    });

    expect(status.challenge.kind).toBe('pace');
    expect(status.completed).toBe(true);
    expect(getTrainingLevel(seeded)).toBe(2);
  });
});
