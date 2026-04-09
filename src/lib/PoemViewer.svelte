<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Poem } from './types';
  import { resolveSpans, tokenizeChars, renderLineSegments } from './matcher';
  import type { Span, CharToken } from './matcher';

  export let poem: Poem;

  const START_DELAY    = 700;   // ms before the first character appears
  const FADE_DURATION  = 2500;  // ms for a connection to fade out after it's replaced

  // ── Config error handling ─────────────────────────────────────────────────
  let configError: string | null = null;

  const resolvedConnections = (() => {
    try {
      return poem.connections.map(conn => ({
        ...conn,
        spans: resolveSpans(poem.lines, conn.phrases),
      }));
    } catch (e) {
      configError = e instanceof Error ? e.message : String(e);
      return [];
    }
  })();

  // ── Character sequence ────────────────────────────────────────────────────
  const charSequence: CharToken[] = tokenizeChars(poem.lines);

  const charPosMap = new Map<string, number>(
    charSequence.map(t => [`${t.lineIndex},${t.charIndex}`, t.flatIndex])
  );

  // ── Trigger events: one per connection, fires at its first phrase ─────────
  interface TriggerEvent { charFlatIndex: number; connectionIndex: number; }

  const triggerEvents: TriggerEvent[] = resolvedConnections
    .map((conn, connectionIndex) => {
      if (!conn.spans.length) return null;
      const lastSpan: Span = conn.spans[conn.spans.length - 1];
      const flatIndex = charPosMap.get(`${lastSpan.lineIndex},${lastSpan.start}`);
      return flatIndex !== undefined ? { charFlatIndex: flatIndex, connectionIndex } : null;
    })
    .filter((e): e is TriggerEvent => e !== null)
    .sort((a, b) => a.charFlatIndex - b.charFlatIndex);

  // ── Reading state ─────────────────────────────────────────────────────────
  let charCursorIndex       = -1;
  let cursorLine            = -1;
  let cursorCharInLine      = -1;
  let activeConnectionIndex: number | null = null;
  let fadingConnectionIndex: number | null = null;
  let paused                = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;

  $: active  = activeConnectionIndex !== null ? resolvedConnections[activeConnectionIndex]  : null;
  $: fading  = fadingConnectionIndex !== null ? resolvedConnections[fadingConnectionIndex] : null;
  $: fadingSpans = fading?.spans ?? [];

  function updateCursorPos() {
    if (charCursorIndex < 0) { cursorLine = -1; cursorCharInLine = -1; return; }
    const tok = charSequence[charCursorIndex];
    cursorLine       = tok.lineIndex;
    cursorCharInLine = tok.charIndex;
  }

  function setActiveConnection(newIndex: number | null) {
    if (newIndex === activeConnectionIndex) return;
    // Previous connection starts fading out
    if (activeConnectionIndex !== null) {
      fadingConnectionIndex = activeConnectionIndex;
      if (fadeTimer) clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => { fadingConnectionIndex = null; }, FADE_DURATION);
    }
    activeConnectionIndex = newIndex;
  }

  function updateActiveConnection() {
    const passed = triggerEvents.filter(e => e.charFlatIndex <= charCursorIndex);
    const next   = passed.length ? passed[passed.length - 1].connectionIndex : null;
    setActiveConnection(next);
  }

  function scheduleNext() {
    if (timer) clearTimeout(timer);
    if (paused || charCursorIndex >= charSequence.length - 1) return;
    const delay = charSequence[charCursorIndex + 1].delayBefore;
    timer = setTimeout(() => {
      charCursorIndex += 1;
      updateCursorPos();
      updateActiveConnection();
      scheduleNext();
    }, delay);
  }

  // ── Controls ──────────────────────────────────────────────────────────────
  function togglePause() {
    paused = !paused;
    if (!paused) scheduleNext();
    else if (timer) { clearTimeout(timer); timer = null; }
  }

  function jumpTo(charFlatIndex: number) {
    charCursorIndex = charFlatIndex;
    updateCursorPos();
    updateActiveConnection();
    if (!paused) scheduleNext();
  }

  function skipToNext() {
    const next = triggerEvents.find(e => e.charFlatIndex > charCursorIndex);
    if (next) jumpTo(next.charFlatIndex);
  }

  function skipToPrev() {
    const prev = [...triggerEvents].reverse().find(e => e.charFlatIndex < charCursorIndex);
    if (prev) jumpTo(prev.charFlatIndex);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  onMount(() => {
    timer = setTimeout(scheduleNext, START_DELAY);
  });

  onDestroy(() => {
    if (timer)     clearTimeout(timer);
    if (fadeTimer) clearTimeout(fadeTimer);
  });
</script>

{#if configError}
  <div class="config-error">
    <strong>Configuration error:</strong> {configError}
  </div>
{/if}

<article class="poem-viewer">
  <header>
    <h1>{poem.title}</h1>
    <p class="author">{poem.author}</p>
  </header>

  <div class="poem-text">
    {#each poem.lines as line, lineIndex}
      <p class="line">
        {#if line.trim() === ''}
          &nbsp;
        {:else}
          {#each renderLineSegments(line, lineIndex, cursorLine, cursorCharInLine, active?.spans ?? [], fadingSpans) as seg}
            <span
              class:glow={seg.highlighted}
              class:glow-decay={seg.fading}
              class:dim={!seg.revealed}
              style={seg.highlighted
                ? `--glow-color: ${active?.color}`
                : seg.fading
                  ? `--glow-color: ${fading?.color}`
                  : ''}
            >{seg.text}</span>
          {/each}
        {/if}
      </p>
    {/each}
  </div>

  <footer class="controls">
    <button on:click={skipToPrev} aria-label="Previous connection">&#8592;</button>

    <button on:click={togglePause} aria-label={paused ? 'Play' : 'Pause'}>
      {paused ? '&#9654;' : '&#9646;&#9646;'}
    </button>

    <button on:click={skipToNext} aria-label="Next connection">&#8594;</button>

    {#if active}
      <span class="connection-label">&mdash; {active.label}</span>
    {/if}
  </footer>
</article>

<style>
  .poem-viewer {
    max-width: 600px;
    margin: 4rem auto;
    padding: 0 1.5rem;
    font-family: Georgia, 'Times New Roman', serif;
    color: #e8e0d0;
  }

  header {
    margin-bottom: 2.5rem;
  }

  h1 {
    font-size: 1.4rem;
    font-weight: normal;
    letter-spacing: 0.04em;
    margin: 0 0 0.25rem;
  }

  .author {
    font-size: 0.9rem;
    color: #888;
    margin: 0;
    font-style: italic;
  }

  .poem-text {
    line-height: 1.9;
    font-size: 1.05rem;
  }

  .line {
    margin: 0;
    min-height: 1.9em;
  }

  /* Base transition for all text spans — governs both reveal and glow attack */
  span {
    transition:
      color 0.5s ease,
      background-color 0.7s ease,
      text-shadow 0.7s ease;
  }

  .dim {
    color: rgba(232, 224, 208, 0.60);
  }

  /* Active connection: glowing */
  .glow {
    border-radius: 3px;
    /* No padding — padding shifts layout as chars join/leave the span */
    background-color: color-mix(in srgb, var(--glow-color) 18%, transparent);
    color: color-mix(in srgb, var(--glow-color) 80%, #e8e0d0);
    text-shadow:
      0 0 8px  color-mix(in srgb, var(--glow-color) 60%, transparent),
      0 0 20px color-mix(in srgb, var(--glow-color) 30%, transparent);
  }

  /* Previous connection: fading back to normal text over a longer duration */
  .glow-decay {
    transition:
      color 2.5s ease,
      background-color 2.5s ease,
      text-shadow 2.5s ease;
    /* No glow properties — CSS transitions FROM the last computed glow values TO normal */
  }

  .controls {
    margin-top: 2.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .controls button {
    background: none;
    border: 1px solid #444;
    color: #aaa;
    border-radius: 4px;
    padding: 0.3rem 0.65rem;
    cursor: pointer;
    font-size: 0.9rem;
    transition: border-color 0.2s, color 0.2s;
  }

  .controls button:hover {
    border-color: #888;
    color: #e8e0d0;
  }

  .connection-label {
    margin-left: 0.25rem;
    color: #555;
    font-style: italic;
    font-size: 0.8rem;
  }

  :global(.config-error) {
    max-width: 600px;
    margin: 2rem auto;
    padding: 1rem 1.5rem;
    background: #2a0a0a;
    border: 1px solid #7f1d1d;
    border-radius: 6px;
    color: #fca5a5;
    font-family: monospace;
    font-size: 0.85rem;
    line-height: 1.6;
  }
</style>
