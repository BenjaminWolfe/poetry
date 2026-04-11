<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Poem } from './types';
  import { resolveSpans, tokenizeChars, renderLineSegments } from './matcher';
  import type { Span, CharToken, FadeGroup } from './matcher';

  export let poem: Poem;

  const START_DELAY    = 700;   // ms before the first character appears
  const HOLD_DURATION  = 200;   // ms after cursor leaves the last phrase before fade begins
  const FADE_DURATION  = 2500;  // ms for the CSS fade-out transition

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

  // ── Trigger events: one per PHRASE, fires at the FIRST char of that phrase ──
  // Firing at the start means the glow begins letter-by-letter as the cursor
  // reads through each highlighted word, instead of snapping on after the fact.
  interface TriggerEvent {
    charFlatIndex: number;   // flat index of the FIRST char of the phrase
    connectionIndex: number;
    phraseIndex: number;     // which phrase within that connection
  }

  const triggerEvents: TriggerEvent[] = [];

  for (let ci = 0; ci < resolvedConnections.length; ci++) {
    const conn = resolvedConnections[ci];
    for (let pi = 0; pi < conn.spans.length; pi++) {
      const span = conn.spans[pi];
      // Trigger at the FIRST character of the span
      const flatIndex = charPosMap.get(`${span.lineIndex},${span.start}`);
      if (flatIndex !== undefined) {
        triggerEvents.push({ charFlatIndex: flatIndex, connectionIndex: ci, phraseIndex: pi });
      }
    }
  }

  triggerEvents.sort((a, b) =>
    a.charFlatIndex !== b.charFlatIndex
      ? a.charFlatIndex - b.charFlatIndex
      : b.connectionIndex - a.connectionIndex  // lower connectionIndex wins ties
  );

  // For skip-to-next/prev navigation, jump to the start of the last phrase
  // (so you land where the connection fully activates and can watch it reveal).
  const connectionTriggers: { charFlatIndex: number; connectionIndex: number }[] =
    resolvedConnections
      .map((conn, ci) => {
        if (!conn.spans.length) return null;
        const lastSpan = conn.spans[conn.spans.length - 1];
        const flatIndex = charPosMap.get(`${lastSpan.lineIndex},${lastSpan.start}`);
        return flatIndex !== undefined ? { charFlatIndex: flatIndex, connectionIndex: ci } : null;
      })
      .filter((e): e is { charFlatIndex: number; connectionIndex: number } => e !== null)
      .sort((a, b) => a.charFlatIndex - b.charFlatIndex);

  // ── Reading state ─────────────────────────────────────────────────────────
  let charCursorIndex       = -1;
  let cursorLine            = -1;
  let cursorCharInLine      = -1;

  // reachedPhrases[connectionIndex] = number of phrases whose trigger the cursor has passed
  let reachedPhrases: number[] = resolvedConnections.map(() => 0);

  // Flat index of the last trigger event we acted on.
  // setActiveConnection is only called when a NEW trigger fires, not on every char advance.
  let lastTriggerFlatIndex  = -1;

  let activeConnectionIndex: number | null = null;

  // Multiple connections can be fading simultaneously — each with its own timer.
  interface FadeEntry { connIndex: number; count: number; color: string; timer: ReturnType<typeof setTimeout>; }
  let fadingList: FadeEntry[] = [];

  let done      = false;
  let paused    = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  $: active = activeConnectionIndex !== null ? resolvedConnections[activeConnectionIndex] : null;
  $: activeReachedCount = activeConnectionIndex !== null ? reachedPhrases[activeConnectionIndex] : 0;
  $: activeSpans = active ? active.spans.slice(0, activeReachedCount) : [];
  $: fadeGroups = fadingList.map(f => ({
    spans: resolvedConnections[f.connIndex].spans.slice(0, f.count),
    color: f.color,
  })) satisfies FadeGroup[];

  function updateCursorPos() {
    if (charCursorIndex < 0) { cursorLine = -1; cursorCharInLine = -1; return; }
    const tok = charSequence[charCursorIndex];
    cursorLine       = tok.lineIndex;
    cursorCharInLine = tok.charIndex;
  }

  function startFade(connIndex: number) {
    const count = reachedPhrases[connIndex];
    const color = resolvedConnections[connIndex].color;
    // If already in the fading list, cancel its old timer and update it
    const existing = fadingList.find(f => f.connIndex === connIndex);
    if (existing) clearTimeout(existing.timer);
    const t = setTimeout(() => {
      fadingList = fadingList.filter(f => f.connIndex !== connIndex);
    }, FADE_DURATION);
    fadingList = [
      ...fadingList.filter(f => f.connIndex !== connIndex),
      { connIndex, count, color, timer: t },
    ];
  }

  function scheduleAutoFade() {
    if (holdTimer) clearTimeout(holdTimer);
    const connToFade = activeConnectionIndex;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (activeConnectionIndex === connToFade && connToFade !== null) {
        startFade(connToFade);
        activeConnectionIndex = null;
      }
    }, HOLD_DURATION);
  }

  function setActiveConnection(newIndex: number | null) {
    if (newIndex === activeConnectionIndex) {
      // Same connection, new phrase triggered — cancel any pending per-phrase decay.
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      return;
    }
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (activeConnectionIndex !== null) startFade(activeConnectionIndex);
    activeConnectionIndex = newIndex;
    // If this connection was fading out, pull it back to active.
    if (newIndex !== null) {
      const existing = fadingList.find(f => f.connIndex === newIndex);
      if (existing) {
        clearTimeout(existing.timer);
        fadingList = fadingList.filter(f => f.connIndex !== newIndex);
      }
    }
  }

  function updateActiveConnection() {
    const passedEvents = triggerEvents.filter(e => e.charFlatIndex <= charCursorIndex);

    const newReached = resolvedConnections.map(() => 0);
    for (const e of passedEvents) {
      newReached[e.connectionIndex] = Math.max(newReached[e.connectionIndex], e.phraseIndex + 1);
    }
    reachedPhrases = newReached;

    // Only call setActiveConnection when a NEW trigger event fires — not on every char
    // advance. Without this gate, setActiveConnection(same) would cancel the holdTimer
    // on every char, preventing per-phrase decay from ever firing. And after a per-phrase
    // fade clears activeConnectionIndex, the next char would re-activate it from lastEvent.
    const lastEvent = passedEvents.length ? passedEvents[passedEvents.length - 1] : null;
    const currentTriggerFlatIndex = lastEvent ? lastEvent.charFlatIndex : -1;
    if (currentTriggerFlatIndex > lastTriggerFlatIndex) {
      lastTriggerFlatIndex = currentTriggerFlatIndex;
      setActiveConnection(lastEvent!.connectionIndex);
    }

    // Schedule auto-fade once the cursor has moved past the last char of the current phrase
    // (per-phrase decay). Re-activates with all prior phrases when the next phrase triggers.
    if (activeConnectionIndex !== null && holdTimer === null) {
      const phraseIdx = reachedPhrases[activeConnectionIndex] - 1;
      if (phraseIdx >= 0) {
        const conn = resolvedConnections[activeConnectionIndex];
        const currentSpan = conn.spans[phraseIdx];
        const lastCharFlat = charPosMap.get(`${currentSpan.lineIndex},${currentSpan.end - 1}`);
        if (lastCharFlat !== undefined && charCursorIndex >= lastCharFlat) {
          scheduleAutoFade();
        }
      }
    }
  }

  function scheduleNext() {
    if (timer) clearTimeout(timer);
    if (paused || charCursorIndex >= charSequence.length - 1) {
      if (charCursorIndex >= charSequence.length - 1) done = true;
      return;
    }
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
    lastTriggerFlatIndex = -1;
    charCursorIndex = charFlatIndex;
    updateCursorPos();
    updateActiveConnection();
    done = charCursorIndex >= charSequence.length - 1;
    if (!paused) scheduleNext();
  }

  function skipToNext() {
    const next = connectionTriggers.find(e => e.charFlatIndex > charCursorIndex);
    if (next) jumpTo(next.charFlatIndex);
  }

  function skipToPrev() {
    const prev = [...connectionTriggers].reverse().find(e => e.charFlatIndex < charCursorIndex);
    if (prev) jumpTo(prev.charFlatIndex);
  }

  function clearAllTimers() {
    if (timer)     { clearTimeout(timer);     timer     = null; }
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    for (const f of fadingList) clearTimeout(f.timer);
  }

  function replay() {
    clearAllTimers();
    fadingList            = [];
    activeConnectionIndex = null;
    reachedPhrases        = resolvedConnections.map(() => 0);
    charCursorIndex       = -1;
    cursorLine            = -1;
    cursorCharInLine      = -1;
    done                  = false;
    paused                = false;
    lastTriggerFlatIndex  = -1;
    timer = setTimeout(scheduleNext, START_DELAY);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  onMount(() => {
    timer = setTimeout(scheduleNext, START_DELAY);
  });

  onDestroy(() => {
    clearAllTimers();
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
          {#each renderLineSegments(line, lineIndex, cursorLine, cursorCharInLine, activeSpans, active?.color ?? null, fadeGroups) as seg}
            <span
              class:glow={seg.highlighted}
              class:glow-decay={seg.fading}
              class:dim={!seg.revealed}
              style={seg.color ? `--glow-color: ${seg.color}` : ''}
            >{seg.text}</span>
          {/each}
        {/if}
      </p>
    {/each}
  </div>

  <footer class="controls">
    <button on:click={skipToPrev} aria-label="Previous connection">&#8592;</button>

    {#if done}
      <button on:click={replay} aria-label="Replay">&#8635;</button>
    {:else}
      <button on:click={togglePause} aria-label={paused ? 'Play' : 'Pause'}>
        {paused ? '&#9654;' : '&#9646;&#9646;'}
      </button>
    {/if}

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
  /* text-shadow decays faster than color/bg to prevent glow bleed onto adjacent phrases */
  .glow-decay {
    transition:
      color 2.5s ease,
      background-color 2.5s ease,
      text-shadow 0.6s ease;
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
