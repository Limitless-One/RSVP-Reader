import { PERSONALIZATION_TRAINING_WORDS, TIME_OF_DAY_BUCKETS } from '../../shared/constants';
import type { Chunk, PersonalizationEvent, PersonalizationModel } from '../../shared/types';

const FEATURE_COUNT = 10;

export interface PersonalizationContext {
  baseWpm: number;
  sessionDurationMinutes: number;
  wordsReadToday: number;
  paragraphDensity: number;
  currentChunkIndex: number;
}

export function makeEvent(
  action: PersonalizationEvent['action'],
  chapterUrl: string,
  chunk: Chunk,
  context: PersonalizationContext,
  createdAt = Date.now(),
): PersonalizationEvent {
  const wordTokens = chunk.tokens.filter(token => token.type === 'word' || token.type === 'number');
  const averageWordLength = wordTokens.length > 0
    ? wordTokens.reduce((sum, token) => sum + token.charCount, 0) / wordTokens.length
    : 0;
  const stopWordRatio = wordTokens.length > 0
    ? wordTokens.filter(token => token.isStopWord).length / wordTokens.length
    : 0;

  return {
    id: `${createdAt}-${chunk.index}-${action}`,
    chapterUrl,
    chunkIndex: chunk.index,
    wordIndex: chunk.wordStartIndex,
    wordLength: Math.round(averageWordLength),
    isProperNoun: wordTokens.some(token => token.isProperNoun),
    isNumber: wordTokens.some(token => token.type === 'number'),
    stopWordRatio,
    sentencePosition: chunk.isSentenceEnd ? 1 : 0,
    paragraphDensity: context.paragraphDensity,
    timeOfDayBucket: timeOfDayBucket(createdAt),
    sessionDurationMinutes: context.sessionDurationMinutes,
    wordsReadToday: context.wordsReadToday,
    action,
    createdAt,
  };
}

export function trainModel(events: PersonalizationEvent[]): PersonalizationModel | null {
  if (events.length < 25) return null;

  const weights = new Array<number>(FEATURE_COUNT).fill(0);
  let bias = 0;
  const learningRate = 0.08;
  const epochs = 180;

  for (let epoch = 0; epoch < epochs; epoch++) {
    for (const event of events) {
      const features = featureVector(event);
      const prediction = sigmoid(dot(weights, features) + bias);
      const label = labelForEvent(event);
      const error = prediction - label;

      for (let index = 0; index < weights.length; index++) {
        weights[index] -= learningRate * error * features[index];
      }
      bias -= learningRate * error;
    }
  }

  return {
    weights,
    bias,
    trainedAt: Date.now(),
  };
}

export function predictDelayMultiplier(
  model: PersonalizationModel,
  chunk: Chunk,
  context: PersonalizationContext,
): number {
  const event = makeEvent('pass', '', chunk, context);
  const comfort = sigmoid(dot(model.weights, featureVector(event)) + model.bias);
  return clamp(1 + (0.5 - comfort) * 0.6, 0.75, 1.35);
}

export function shouldTrain(wordsSinceTraining: number): boolean {
  return wordsSinceTraining >= PERSONALIZATION_TRAINING_WORDS;
}

function featureVector(event: PersonalizationEvent): number[] {
  return [
    event.wordLength / 12,
    event.isProperNoun ? 1 : 0,
    event.isNumber ? 1 : 0,
    event.stopWordRatio,
    event.sentencePosition,
    event.paragraphDensity / 40,
    timeBucketValue(event.timeOfDayBucket),
    event.sessionDurationMinutes / 60,
    event.wordsReadToday / PERSONALIZATION_TRAINING_WORDS,
    1,
  ];
}

function labelForEvent(event: PersonalizationEvent): number {
  return event.action === 'pass' || event.action === 'speed_up' ? 1 : 0;
}

function timeOfDayBucket(timestamp: number): PersonalizationEvent['timeOfDayBucket'] {
  const hour = new Date(timestamp).getHours();
  if (hour >= TIME_OF_DAY_BUCKETS.morning[0] && hour < TIME_OF_DAY_BUCKETS.morning[1]) return 'morning';
  if (hour >= TIME_OF_DAY_BUCKETS.afternoon[0] && hour < TIME_OF_DAY_BUCKETS.afternoon[1]) return 'afternoon';
  if (hour >= TIME_OF_DAY_BUCKETS.evening[0] && hour < TIME_OF_DAY_BUCKETS.evening[1]) return 'evening';
  return 'night';
}

function timeBucketValue(bucket: PersonalizationEvent['timeOfDayBucket']): number {
  switch (bucket) {
    case 'morning':
      return 0.25;
    case 'afternoon':
      return 0.5;
    case 'evening':
      return 0.75;
    default:
      return 1;
  }
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
