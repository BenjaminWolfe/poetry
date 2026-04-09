import type { PhraseEntry } from './types';

export interface Span {
  // Which line (0-indexed) this span lives on
  lineIndex: number;
  // Character offsets within that line's text
  start: number;
  end: number;
}

// Parse "*still* happy" into { matchText: "still happy", highlightText: "still" }
// If no asterisks, both are the same string.
function parsePhraseEntry(entry: PhraseEntry): {
  matchText: string;
  highlightText: string;
  lineHint: number | null;
} {
  const raw = typeof entry === 'string' ? entry : entry.text;
  const lineHint = typeof entry === 'string' ? null : entry.line - 1; // convert to 0-indexed

  const asteriskPattern = /\*([^*]+)\*/g;
  let highlightText = '';
  const matchText = raw.replace(asteriskPattern, (_, inner) => {
    highlightText += (highlightText ? ' ' : '') + inner;
    return inner;
  });

  // No asterisks — highlight the whole phrase
  if (!highlightText) highlightText = matchText;

  return { matchText: matchText.trim(), highlightText: highlightText.trim(), lineHint };
}

// Case-insensitive, word-boundary-aware search for needle within haystack.
// Returns [start, end] or null.
// Word boundaries prevent "pity" from matching inside "pitiless".
function findIn(haystack: string, needle: string): [number, number] | null {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  const match = regex.exec(haystack);
  if (!match) return null;
  return [match.index, match.index + match[0].length];
}

// Given a line and the match/highlight texts, return the span of the highlighted
// portion within that line (the highlight may be a substring of the match).
function resolveSpan(line: string, lineIndex: number, matchText: string, highlightText: string): Span | null {
  const matchRange = findIn(line, matchText);
  if (!matchRange) return null;

  const [matchStart] = matchRange;

  // Find the highlight within the match (not the whole line) to get precise offset
  const matchSlice = line.slice(matchStart, matchStart + matchText.length);
  const hlRange = findIn(matchSlice, highlightText);
  if (!hlRange) return null;

  return {
    lineIndex,
    start: matchStart + hlRange[0],
    end: matchStart + hlRange[1],
  };
}

// Resolve all phrases in a connection to Span[].
// Throws if any phrase is ambiguous (matches more than once without a line hint).
export function resolveSpans(lines: string[], phrases: PhraseEntry[]): Span[] {
  const spans: Span[] = [];

  for (const entry of phrases) {
    const { matchText, highlightText, lineHint } = parsePhraseEntry(entry);

    const candidates: Span[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lineHint !== null && i !== lineHint) continue;
      const span = resolveSpan(lines[i], i, matchText, highlightText);
      if (span) candidates.push(span);
    }

    if (candidates.length === 0) {
      throw new Error(`Phrase not found in poem: "${matchText}"`);
    }
    if (candidates.length > 1) {
      throw new Error(
        `Phrase "${matchText}" is ambiguous — found on lines ${candidates.map(s => s.lineIndex + 1).join(', ')}. ` +
        `Use { line: N, text: "..." } to disambiguate.`
      );
    }

    spans.push(candidates[0]);
  }

  return spans;
}

// ---------------------------------------------------------------------------
// Word tokenization and reveal rendering
// ---------------------------------------------------------------------------

export interface WordToken {
  lineIndex: number;
  start: number; // char offset in line
  end: number;
  flatIndex: number; // position in the flat across-all-lines list
}

// Build a flat list of every word in the poem, in reading order.
// "Word" = any run of non-whitespace characters (punctuation stays attached).
export function tokenizeWords(lines: string[]): WordToken[] {
  const tokens: WordToken[] = [];
  let flatIndex = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const wordRegex = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = wordRegex.exec(lines[lineIndex])) !== null) {
      tokens.push({
        lineIndex,
        start: match.index,
        end: match.index + match[0].length,
        flatIndex: flatIndex++,
      });
    }
  }
  return tokens;
}

export interface RenderSegment {
  text: string;
  revealed: boolean; // has the reading cursor passed this text?
  highlighted: boolean; // is this part of the active connection?
}

// Merge word-level reveal state and connection span highlights into a single
// list of segments for rendering a line.
//
// Highlighted text is always treated as revealed (connections can point ahead
// in the poem before the cursor arrives, so the full connection is visible
// as soon as it triggers).
export function renderLineSegments(
  lineText: string,
  lineIndex: number,
  wordTokens: WordToken[],
  cursorIndex: number,
  activeSpans: Span[],
): RenderSegment[] {
  const lineTokens = wordTokens.filter(t => t.lineIndex === lineIndex);
  const lineSpans  = activeSpans.filter(s => s.lineIndex === lineIndex);

  // Collect all character positions where something changes
  const breakpointSet = new Set<number>([0, lineText.length]);
  for (const t of lineTokens) { breakpointSet.add(t.start); breakpointSet.add(t.end); }
  for (const s of lineSpans)  { breakpointSet.add(s.start); breakpointSet.add(s.end); }

  const breakpoints = Array.from(breakpointSet).sort((a, b) => a - b);
  const segments: RenderSegment[] = [];

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const segStart = breakpoints[i];
    const segEnd   = breakpoints[i + 1];
    const text = lineText.slice(segStart, segEnd);
    if (!text) continue;

    const mid = (segStart + segEnd) / 2;

    // Is this segment's text revealed by the cursor?
    const containingToken = lineTokens.find(t => t.start <= mid && t.end > mid);
    let revealed: boolean;
    if (containingToken) {
      revealed = containingToken.flatIndex <= cursorIndex;
    } else {
      // Whitespace between words: revealed once the preceding word is revealed
      const prevToken = lineTokens.filter(t => t.end <= segStart).pop();
      revealed = prevToken ? prevToken.flatIndex <= cursorIndex : false;
    }

    const highlighted = lineSpans.some(s => s.start <= segStart && s.end >= segEnd);

    segments.push({ text, revealed: revealed || highlighted, highlighted });
  }

  return segments;
}

