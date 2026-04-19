# Poetry Highlighting Viewer

An interactive, meditative poetry viewer built with Svelte + TypeScript + Vite. It renders poems word-by-word with a letter-by-letter glow reveal, and highlights thematic "connections" (groups of phrases that share a common thread) with fade-in/fade-out effects.

## Project Layout

```
src/
  App.svelte          # Root component; loads poem YAML and drives PoemViewer
  lib/
    PoemViewer.svelte # Main viewer: revelation animation, connection highlighting
    matcher.ts        # Matches connection phrases to their positions in the poem
    types.ts          # Shared TypeScript types (Poem, Connection, etc.)
  main.ts             # Vite entry point
  yaml.d.ts           # Type declaration for YAML imports
poems/
  looking-back.yaml   # The poem and its connections, in YAML format
public/               # Static assets
```

## Development

```bash
npm run dev      # Start Vite dev server (HMR)
npm run build    # Production build
npm run preview  # Preview the production build
npm run check    # Run svelte-check + tsc type checking
```

## Key Concepts

- **Revelation**: Words are revealed character-by-character with a glow effect at a configurable `SPEED` multiplier.
- **Connections**: Defined in the poem YAML, each connection is a group of phrases that are highlighted together. They fade in when the last phrase of the connection is reached, and auto-fade out after display.
- **Simultaneous fading**: Multiple connections can be active (fading in or out) at the same time.
- **Poem YAML format**: Each poem file defines the poem text and a list of named connections with their constituent phrases.

## Git / Branch Workflow

- Active development branch: `claude/poetry-highlighting-design-9m9rG`
- Always push to that branch: `git push -u origin claude/poetry-highlighting-design-9m9rG`
- Only push to `main` when explicitly asked to. Prefer fast-forward or rebase merges to keep both branches on the same commit history.

## Guidelines for Claude

- Do not refactor working code unless asked.
- Do not add comments or docstrings to unchanged code.
- Keep the meditative, minimal aesthetic in mind for any UI changes.
- The `SPEED` constant in `PoemViewer.svelte` is the primary knob for pacing — check there first for timing issues.
- Before suggesting new abstractions, check whether the task truly requires them; three similar lines beat a premature helper.
