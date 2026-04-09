// A phrase entry in a connection.
// Simple string form:  "still happy"         → match & highlight whole phrase
// Asterisk form:       "*still* happy"        → match "still happy", highlight only "still"
// Anchored form:       { line: 11, text: "..." } → disambiguate repeated phrases
export type PhraseEntry = string | { line: number; text: string };

export interface Connection {
  label: string;
  color: string;
  phrases: PhraseEntry[];
  // seconds each connection is shown before auto-advancing (default: 4)
  duration?: number;
}

export interface Poem {
  title: string;
  author: string;
  lines: string[];
  connections: Connection[];
}
