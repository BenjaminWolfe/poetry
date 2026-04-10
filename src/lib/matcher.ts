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
// Character tokenization and reveal rendering
// ---------------------------------------------------------------------------

// Timing constants (ms) — tune these to adjust reading feel.
// SPEED scales all delays proportionally: 1.0 = current, 0.5 = twice as fast, 2.0 = twice as slow.
const SPEED        = 1.0;
const CHAR_MS      = 50  * SPEED;  // per-character rate within a word
const WORD_PAUSE   = 190 * SPEED;  // pause before the first char of a new word
const LINE_PAUSE   = 520 * SPEED;  // pause before the first word of a new line
const STANZA_PAUSE = 1300 * SPEED; // pause before the first word after a blank line

export interface CharToken {
  lineIndex: number;
  charIndex: number;  // position within the line text
  flatIndex: number;  // position in the flat across-all-lines sequence
  delayBefore: number; // ms to wait before revealing this character
}

// Build a flat sequence of every non-whitespace character, in reading order,
// with inter-character delays encoding word/line/stanza rhythm.
// Spaces are omitted from the sequence — they reveal implicitly in renderLineSegments.
export function tokenizeChars(lines: string[]): CharToken[] {
  const tokens: CharToken[] = [];
  let flatIndex = 0;
  let prevContentLine = -1;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line.trim()) continue; // blank line — marks a stanza break

    const isAfterStanza = prevContentLine !== -1 && li > prevContentLine + 1;
    let inWord = false;

    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      if (/\s/.test(ch)) { inWord = false; continue; }

      let delay: number;

      if (!inWord) {
        // First character of a word — determine structural delay
        const isFirstOfLine = !/\S/.test(line.slice(0, ci));
        if (isFirstOfLine) {
          if (flatIndex === 0)      delay = 0;           // very first char
          else if (isAfterStanza)   delay = STANZA_PAUSE;
          else                      delay = LINE_PAUSE;
        } else {
          // Word within a line — check if the preceding word ended with punctuation
          let extra = 0;
          for (let j = ci - 1; j >= 0; j--) {
            if (/\s/.test(line[j])) continue;
            if (/[,;:]/.test(line[j]))  extra = 80;
            if (/[.!?]/.test(line[j]))  extra = 160;
            break;
          }
          delay = WORD_PAUSE + extra;
        }
        inWord = true;
      } else {
        delay = CHAR_MS;
      }

      tokens.push({ lineIndex: li, charIndex: ci, flatIndex: flatIndex++, delayBefore: delay });
    }

    prevContentLine = li;
  }

  return tokens;
}

export interface RenderSegment {
  text: string;
  revealed: boolean;    // has the reading cursor passed this text?
  highlighted: boolean; // is this part of the active connection?
  fading: boolean;      // is this part of a connection currently fading out?
  color: string | null; // --glow-color for both highlighted and fading states
}

// A group of spans currently fading out, with their connection color.
export interface FadeGroup {
  spans: Span[];
  color: string;
}

// Produce a list of render segments for one line given the current cursor position,
// active connection spans + color, and any connections currently fading out.
//
// cursorLine / cursorCharInLine: the line and char index of the last revealed character
// (-1 / -1 = nothing revealed yet).
//
// Characters glow only once the cursor has physically reached them (hl && rev),
// so highlighting builds letter-by-letter as the cursor reads each phrase.
// Characters on lines above the cursor are always "revealed" so past phrases stay lit.
export function renderLineSegments(
  lineText: string,
  lineIndex: number,
  cursorLine: number,
  cursorCharInLine: number,
  activeSpans: Span[],
  activeColor: string | null = null,
  fadeGroups: FadeGroup[] = [],
): RenderSegment[] {
  const lineActive = activeSpans.filter(s => s.lineIndex === lineIndex);
  const lineFadeGroups = fadeGroups
    .map(g => ({ ...g, spans: g.spans.filter(s => s.lineIndex === lineIndex) }))
    .filter(g => g.spans.length > 0);

  function isRevealed(ci: number): boolean {
    if (lineIndex < cursorLine) return true;
    if (lineIndex > cursorLine) return false;
    if (/\s/.test(lineText[ci])) {
      for (let j = ci - 1; j >= 0; j--) {
        if (!/\s/.test(lineText[j])) return j <= cursorCharInLine;
      }
      return false;
    }
    return ci <= cursorCharInLine;
  }

  // Compute the full visual state for a character position.
  function stateAt(ci: number): { rev: boolean; hl: boolean; fading: boolean; color: string | null } {
    const rev = isRevealed(ci);
    if (rev && lineActive.some(s => s.start <= ci && ci < s.end)) {
      return { rev, hl: true, fading: false, color: activeColor };
    }
    if (rev) {
      // Most recently added fade group wins (iterate in reverse)
      for (let i = lineFadeGroups.length - 1; i >= 0; i--) {
        if (lineFadeGroups[i].spans.some(s => s.start <= ci && ci < s.end)) {
          return { rev, hl: false, fading: true, color: lineFadeGroups[i].color };
        }
      }
    }
    return { rev, hl: false, fading: false, color: null };
  }

  const segments: RenderSegment[] = [];
  let segStart = 0;
  let prev = stateAt(0);

  for (let ci = 1; ci <= lineText.length; ci++) {
    const atEnd = ci === lineText.length;
    const curr = atEnd ? prev : stateAt(ci);

    const changed = !atEnd && (
      curr.rev !== prev.rev ||
      curr.hl  !== prev.hl  ||
      curr.fading !== prev.fading ||
      curr.color  !== prev.color
    );

    if (!atEnd && !changed) { prev = curr; continue; }

    const text = lineText.slice(segStart, ci);
    if (text) {
      segments.push({
        text,
        revealed: prev.rev || prev.fading,
        highlighted: prev.hl,
        fading: prev.fading,
        color: prev.color,
      });
    }
    segStart = ci;
    prev = curr;
  }

  return segments;
}
