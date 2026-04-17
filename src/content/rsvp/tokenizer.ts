import { ABBREVIATIONS } from '../../shared/constants';
import type {
  Chunk,
  ParsedBlock,
  PunctuationType,
  ReadingMode,
  SegmentationMode,
  Token,
  TokenType,
} from '../../shared/types';
import { STOP_WORDS } from '../../shared/stopwords';

const WORD_RE = /[\p{L}\p{M}]+(?:['\u2019][\p{L}\p{M}]+)*(?:-[\p{L}\p{M}]+)*/uy;
const NUMBER_RE = /[\p{Nd}][\p{Nd},.'’]*[\p{Nd}]|[\p{Nd}]/uy;
const CLOSING_PUNCT_RE = /^[,.;:!?)}\]%"'”’]+$/;
const OPENING_PUNCT_RE = /^[(\[{“‘'"]+$/;
const SOFT_BOUNDARY_WORDS = new Set([
  'and', 'but', 'or', 'so', 'yet', 'for', 'nor',
  'because', 'although', 'though', 'while', 'when', 'where', 'which', 'that',
  'who', 'whom', 'whose', 'after', 'before', 'until', 'unless', 'since',
  'with', 'without', 'through', 'across', 'between', 'beneath', 'inside',
  'outside', 'toward', 'towards', 'against', 'instead', 'despite', 'beyond',
  'into', 'onto', 'over', 'under', 'around', 'from',
]);

interface ChunkingProfile {
  minWords: number;
  targetWords: number;
  maxWords: number;
}

export function bionicHtml(word: string): string {
  if (word.length <= 1) return `<b>${word}</b>`;
  const boldLen = Math.max(1, Math.ceil(word.length * 0.5));
  return `<b>${word.slice(0, boldLen)}</b>${word.slice(boldLen)}`;
}

export function buildChunks(
  text: string,
  blocks: ParsedBlock[],
  chunkSize: number,
  sentenceMode: boolean,
  segmentationMode: SegmentationMode = 'fixed',
  readingMode: ReadingMode = 'balanced',
  adaptiveChunkSizing = segmentationMode !== 'fixed',
): Chunk[] {
  const tokens = tokenize(text);
  const wordTokens = tokens.filter(token => token.type === 'word' || token.type === 'number');
  if (wordTokens.length === 0) return [];

  const chunks: Chunk[] = [];
  const effectiveSegmentationMode = adaptiveChunkSizing && segmentationMode === 'fixed'
    ? 'phrase'
    : segmentationMode;
  const profile = buildChunkingProfile(chunkSize, effectiveSegmentationMode, readingMode);
  let chunkStart = 0;
  let wordsInChunk = 0;
  let firstWordIndex = 0;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'word' && token.type !== 'number') continue;

    if (wordsInChunk === 0) {
      firstWordIndex = token.wordIndex ?? firstWordIndex;
      chunkStart = findChunkStart(tokens, index);
    }

    wordsInChunk++;
    const isSentenceEnd =
      token.punctuationAfter === 'sentence' || token.punctuationAfter === 'ellipsis';

    let shouldCloseChunk = false;
    if (sentenceMode) {
      const fallbackLimit = Math.max(profile.maxWords + 2, Math.max(chunkSize, 1) * 4, 14);
      shouldCloseChunk = isSentenceEnd || wordsInChunk >= fallbackLimit;
    } else if (!adaptiveChunkSizing) {
      shouldCloseChunk = wordsInChunk >= chunkSize;
    } else {
      shouldCloseChunk = shouldCloseSemanticChunk(tokens, index, wordsInChunk, profile, readingMode);
    }

    if (!shouldCloseChunk) continue;

    const chunkEnd = findChunkEnd(tokens, index);
    chunks.push(makeChunk(tokens, text, blocks, chunkStart, chunkEnd, chunks.length, firstWordIndex));
    wordsInChunk = 0;
  }

  if (wordsInChunk > 0) {
    chunks.push(makeChunk(tokens, text, blocks, chunkStart, tokens.length - 1, chunks.length, firstWordIndex));
  }

  return chunks;
}

export function renderChunkHtml(
  chunk: Chunk,
  bionic: boolean,
  readingMode: ReadingMode = 'balanced',
): string {
  let html = '';

  chunk.tokens.forEach((token, index) => {
    if (index > 0 && needsSpace(chunk.tokens[index - 1], token)) {
      html += ' ';
    }

    html += renderTokenHtml(token, chunk, bionic, readingMode);
  });

  return html;
}

function renderTokenHtml(
  token: Token,
  chunk: Chunk,
  bionic: boolean,
  readingMode: ReadingMode,
): string {
  const content =
    token.type === 'word' && bionic
      ? bionicHtml(escapeHtml(token.text))
      : escapeHtml(token.text);
  const classes: string[] = [];

  if (readingMode === 'dialogue' && chunk.isDialogue && token.type === 'punctuation' && /["“”'‘’]/.test(token.text)) {
    classes.push('rsvp-quote-token');
  }

  if (readingMode === 'technical' && token.type === 'number') {
    classes.push('rsvp-number-token');
  }

  if (readingMode === 'technical' && chunk.isCodeLike && tokenLooksCodeLike(token)) {
    classes.push('rsvp-code-token');
  }

  if (classes.length === 0) return content;
  return `<span class="${classes.join(' ')}">${content}</span>`;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  let wordIndex = 0;

  while (position < text.length) {
    if (/\s/.test(text[position])) {
      position++;
      continue;
    }

    NUMBER_RE.lastIndex = position;
    const numberMatch = NUMBER_RE.exec(text);
    if (numberMatch) {
      const value = numberMatch[0];
      tokens.push(makeToken(value, 'number', position, position + value.length, text, wordIndex));
      wordIndex++;
      position += value.length;
      continue;
    }

    WORD_RE.lastIndex = position;
    const wordMatch = WORD_RE.exec(text);
    if (wordMatch) {
      const value = wordMatch[0];
      tokens.push(makeToken(value, 'word', position, position + value.length, text, wordIndex));
      wordIndex++;
      position += value.length;
      continue;
    }

    const punct = readPunctuation(text, position);
    const pause = classifyPunct(text, punct.start, punct.value);
    const token = makeToken(punct.value, 'punctuation', punct.start, punct.end, text, null);
    token.punctuationAfter = pause;
    tokens.push(token);

    const previousWord = findPreviousWordToken(tokens);
    if (previousWord && pauseWeight(pause) > pauseWeight(previousWord.punctuationAfter)) {
      previousWord.punctuationAfter = pause;
    }

    position = punct.end;
  }

  markProperNouns(tokens);
  return tokens;
}

function makeToken(
  value: string,
  type: TokenType,
  start: number,
  end: number,
  sourceText: string,
  wordIndex: number | null,
): Token {
  const previousChar = sourceText[start - 1] ?? '';
  return {
    text: value,
    type,
    start,
    end,
    spaceBefore: Boolean(previousChar && /\s/.test(previousChar)),
    wordIndex,
    isStopWord: type === 'word' && STOP_WORDS.has(value.toLowerCase()),
    isProperNoun: false,
    punctuationAfter: 'none',
    charCount: value.length,
  };
}

function readPunctuation(text: string, position: number): { value: string; start: number; end: number } {
  if (text.startsWith('...', position)) {
    return { value: '...', start: position, end: position + 3 };
  }
  return { value: text[position], start: position, end: position + 1 };
}

function classifyPunct(text: string, position: number, value: string): PunctuationType {
  if (value === '...' || value === '…') return 'ellipsis';
  if (value === '—' || value === '–') return 'dash';
  if (value === '.' || value === '!' || value === '?') {
    if (value === '.') {
      const wordBefore = getWordBefore(text, position);
      if (wordBefore && ABBREVIATIONS.has(wordBefore.toLowerCase())) return 'none';
    }
    return 'sentence';
  }
  if (/^[,;:]$/.test(value)) return 'clause';
  return 'none';
}

function getWordBefore(text: string, position: number): string {
  let end = position - 1;
  while (end >= 0 && /\s/.test(text[end])) end--;
  let start = end;
  while (start > 0 && /[\p{L}\p{M}]/u.test(text[start - 1])) start--;
  return text.slice(start, end + 1);
}

function findPreviousWordToken(tokens: Token[]): Token | null {
  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index];
    if (token.type === 'word' || token.type === 'number') return token;
  }
  return null;
}

function findNextWordToken(tokens: Token[], startIndex: number): Token | null {
  for (let index = startIndex; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === 'word' || token.type === 'number') return token;
  }
  return null;
}

function pauseWeight(punctuation: PunctuationType): number {
  return { none: 0, clause: 1, sentence: 2, dash: 3, ellipsis: 3 }[punctuation];
}

function markProperNouns(tokens: Token[]): void {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'word') continue;
    if (token.isStopWord) continue;
    if (!/^\p{Lu}/u.test(token.text)) continue;
    if (isSentenceInitial(tokens, index)) continue;
    token.isProperNoun = true;
  }
}

function isSentenceInitial(tokens: Token[], index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const token = tokens[cursor];
    if (token.type === 'punctuation') {
      if (token.punctuationAfter === 'sentence' || token.punctuationAfter === 'ellipsis') return true;
      continue;
    }
    if (token.punctuationAfter === 'sentence' || token.punctuationAfter === 'ellipsis') return true;
    return false;
  }
  return true;
}

function buildChunkingProfile(
  chunkSize: number,
  segmentationMode: SegmentationMode,
  readingMode: ReadingMode,
): ChunkingProfile {
  const base = Math.max(1, chunkSize);
  if (segmentationMode === 'fixed') {
    return { minWords: base, targetWords: base, maxWords: base };
  }

  let targetWords = base + (segmentationMode === 'phrase' ? 1 : 2);
  let spread = segmentationMode === 'phrase' ? 1 : 2;

  if (readingMode === 'dialogue' || readingMode === 'technical') {
    targetWords = Math.max(2, targetWords - 1);
  } else if (readingMode === 'story') {
    targetWords += 1;
    spread += 1;
  }

  const minWords = Math.max(1, targetWords - spread);
  const maxWords = Math.max(targetWords + 1, targetWords + spread);
  return { minWords, targetWords, maxWords };
}

function shouldCloseSemanticChunk(
  tokens: Token[],
  index: number,
  wordsInChunk: number,
  profile: ChunkingProfile,
  readingMode: ReadingMode,
): boolean {
  const token = tokens[index];
  const nextWord = findNextWordToken(tokens, index + 1);
  const nextWordText = nextWord?.text.toLowerCase() ?? '';

  if (wordsInChunk >= profile.maxWords) return true;

  if (token.punctuationAfter === 'sentence' || token.punctuationAfter === 'ellipsis') {
    return true;
  }

  if (token.punctuationAfter === 'clause' && wordsInChunk >= profile.minWords) {
    return true;
  }

  if (token.punctuationAfter === 'dash' && wordsInChunk >= Math.max(1, profile.minWords - 1)) {
    return true;
  }

  if (wordsInChunk >= profile.targetWords && nextWord && SOFT_BOUNDARY_WORDS.has(nextWordText)) {
    return true;
  }

  if (readingMode === 'dialogue' && wordsInChunk >= profile.minWords && endsWithClosingQuote(tokens, index)) {
    return true;
  }

  if (readingMode === 'technical' && wordsInChunk >= profile.minWords && tokenLooksCodeLike(token)) {
    return true;
  }

  return false;
}

function endsWithClosingQuote(tokens: Token[], index: number): boolean {
  const nextToken = tokens[index + 1];
  return Boolean(nextToken?.type === 'punctuation' && /["”’']/.test(nextToken.text));
}

function tokenLooksCodeLike(token: Token): boolean {
  if (token.type === 'number') return true;
  if (token.type === 'punctuation') return /[<>{}\[\]=_/\\`~:+*#|]/.test(token.text);
  return /[a-z][A-Z]|[A-Za-z]\d|\d[A-Za-z]|[_/\\]/.test(token.text);
}

function findChunkStart(tokens: Token[], index: number): number {
  let cursor = index;
  while (cursor > 0) {
    const previous = tokens[cursor - 1];
    if (previous.type === 'word' || previous.type === 'number') break;
    if (!OPENING_PUNCT_RE.test(previous.text)) break;
    cursor--;
  }
  return cursor;
}

function findChunkEnd(tokens: Token[], lastWordIndex: number): number {
  let cursor = lastWordIndex;
  while (cursor + 1 < tokens.length) {
    const next = tokens[cursor + 1];
    if (next.type === 'word' || next.type === 'number') break;
    cursor++;
  }
  return cursor;
}

function makeChunk(
  tokens: Token[],
  text: string,
  blocks: ParsedBlock[],
  startIndex: number,
  endIndex: number,
  chunkIndex: number,
  firstWordIndex: number,
): Chunk {
  const chunkTokens = tokens.slice(startIndex, endIndex + 1);
  const wordTokens = chunkTokens.filter(token => token.type === 'word' || token.type === 'number');
  const startOffset = chunkTokens[0]?.start ?? 0;
  const endOffset = chunkTokens[chunkTokens.length - 1]?.end ?? startOffset;
  const rawText = text.slice(startOffset, endOffset);
  const displayText = normalizeDisplayText(rawText);
  const wordEndIndex = (wordTokens[wordTokens.length - 1]?.wordIndex ?? firstWordIndex - 1) + 1;
  const containsNumber = wordTokens.some(token => token.type === 'number');

  return {
    tokens: chunkTokens,
    rawText,
    displayText,
    index: chunkIndex,
    isSentenceEnd: wordTokens.some(token =>
      token.punctuationAfter === 'sentence' || token.punctuationAfter === 'ellipsis'),
    startOffset,
    endOffset,
    wordStartIndex: firstWordIndex,
    wordEndIndex,
    wordCount: wordEndIndex - firstWordIndex,
    blockIds: blockIdsForRange(blocks, startOffset, endOffset),
    isDialogue: looksLikeDialogue(displayText, chunkTokens),
    containsNumber,
    isCodeLike: looksCodeLike(rawText, chunkTokens),
  };
}

function normalizeDisplayText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:!?])/g, '$1')
    .trim();
}

function looksLikeDialogue(text: string, tokens: Token[]): boolean {
  const trimmed = text.trimStart();
  if (/^["“'‘-]/.test(trimmed)) return true;
  return Boolean(tokens[0]?.type === 'punctuation' && /["“'‘]/.test(tokens[0].text));
}

function looksCodeLike(rawText: string, tokens: Token[]): boolean {
  if (/::|=>|\b[A-Za-z]+(?:[._][A-Za-z0-9]+)+/.test(rawText)) return true;
  if (/[<>{}\[\]=_/\\`~]/.test(rawText)) return true;

  const codeishTokens = tokens.filter(tokenLooksCodeLike).length;
  return codeishTokens >= 2;
}

function blockIdsForRange(blocks: ParsedBlock[], startOffset: number, endOffset: number): string[] {
  return blocks
    .filter(block => block.startOffset < endOffset && block.endOffset > startOffset)
    .map(block => block.id);
}

function needsSpace(previous: Token, current: Token): boolean {
  if (current.type === 'punctuation' && CLOSING_PUNCT_RE.test(current.text)) return false;
  if (previous.type === 'punctuation' && OPENING_PUNCT_RE.test(previous.text)) return false;
  if (current.type === 'punctuation' && OPENING_PUNCT_RE.test(current.text)) return previous.spaceBefore;
  return current.spaceBefore || previous.type !== 'punctuation';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
