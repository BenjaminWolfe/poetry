<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Poem } from './types';
  import { resolveSpans, segmentLine } from './matcher';

  export let poem: Poem;

  // Index of the currently active connection (-1 = none highlighted)
  let activeIndex = 0;
  let paused = false;

  // Pre-resolve all connections up front so errors surface immediately
  const resolvedConnections = poem.connections.map(conn => ({
    ...conn,
    spans: resolveSpans(poem.lines, conn.phrases),
  }));

  $: active = resolvedConnections[activeIndex] ?? null;

  function advance() {
    activeIndex = (activeIndex + 1) % resolvedConnections.length;
    resetTimer();
  }

  function retreat() {
    activeIndex = (activeIndex - 1 + resolvedConnections.length) % resolvedConnections.length;
    resetTimer();
  }

  function togglePause() {
    paused = !paused;
    if (!paused) resetTimer();
  }

  // Auto-advance timer
  let timer: ReturnType<typeof setTimeout> | null = null;

  function resetTimer() {
    if (timer) clearTimeout(timer);
    if (paused) return;
    const duration = (active?.duration ?? 4) * 1000;
    timer = setTimeout(advance, duration);
  }

  // Start on mount
  resetTimer();

  onDestroy(() => {
    if (timer) clearTimeout(timer);
  });

  // Restart timer whenever active connection changes
  $: active, resetTimer();
</script>

<article class="poem-viewer">
  <header>
    <h1>{poem.title}</h1>
    <p class="author">{poem.author}</p>
  </header>

  <div class="poem-text">
    {#each poem.lines as line, lineIndex}
      <p class="line" class:blank={line.trim() === ''}>
        {#if line.trim() === ''}
          &nbsp;
        {:else if active}
          {#each segmentLine(line, active.spans, lineIndex) as seg}
            {#if seg.highlighted}
              <span
                class="glow"
                style="--glow-color: {active.color}"
              >{seg.text}</span>
            {:else}
              {seg.text}
            {/if}
          {/each}
        {:else}
          {line}
        {/if}
      </p>
    {/each}
  </div>

  <footer class="controls">
    <button on:click={retreat} aria-label="Previous connection">&#8592;</button>

    <button on:click={togglePause} class="pause-btn" aria-label={paused ? 'Play' : 'Pause'}>
      {paused ? '&#9654;' : '&#9646;&#9646;'}
    </button>

    <button on:click={advance} aria-label="Next connection">&#8594;</button>

    <span class="connection-label">
      {activeIndex + 1} / {resolvedConnections.length}
      {#if active} &mdash; {active.label}{/if}
    </span>
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

  /* The glow effect */
  .glow {
    border-radius: 3px;
    padding: 0 1px;
    transition:
      background-color 0.6s ease,
      text-shadow 0.6s ease,
      color 0.6s ease;
    background-color: color-mix(in srgb, var(--glow-color) 18%, transparent);
    color: color-mix(in srgb, var(--glow-color) 80%, #e8e0d0);
    text-shadow:
      0 0 8px color-mix(in srgb, var(--glow-color) 60%, transparent),
      0 0 20px color-mix(in srgb, var(--glow-color) 30%, transparent);
  }

  .controls {
    margin-top: 2.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.85rem;
    color: #666;
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
    margin-left: 0.5rem;
    color: #666;
    font-style: italic;
    font-size: 0.8rem;
  }
</style>
