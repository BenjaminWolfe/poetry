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

// Split a single line's text into segments: plain text and highlighted spans.
export interface Segment {
  text: string;
  highlighted: boolean;
}

export function segmentLine(lineText: string, spans: Span[], lineIndex: number): Segment[] {
  // Collect all highlight ranges on this line, sorted by start position
  const ranges = spans
    .filter(s => s.lineIndex === lineIndex)
    .sort((a, b) => a.start - b.start);

  if (ranges.length === 0) return [{ text: lineText, highlighted: false }];

  const segments: Segment[] = [];
  let cursor = 0;

  for (const range of ranges) {
    if (cursor < range.start) {
      segments.push({ text: lineText.slice(cursor, range.start), highlighted: false });
    }
    segments.push({ text: lineText.slice(range.start, range.end), highlighted: true });
    cursor = range.end;
  }

  if (cursor < lineText.length) {
    segments.push({ text: lineText.slice(cursor), highlighted: false });
  }

  return segments;
}
