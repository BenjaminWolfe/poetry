<script lang="ts">
  import PoemViewer from './lib/PoemViewer.svelte';
  import type { Poem } from './lib/types';

  // Import poems — add new ones here as you create YAML files
  import lookingBack from '../poems/looking-back.yaml';

  const poems: Poem[] = [lookingBack as unknown as Poem];

  let selectedIndex = 0;
  $: poem = poems[selectedIndex];
</script>

<main>
  {#if poems.length > 1}
    <nav class="poem-nav">
      {#each poems as p, i}
        <button
          class:active={i === selectedIndex}
          on:click={() => { selectedIndex = i; }}
        >{p.title}</button>
      {/each}
    </nav>
  {/if}

  {#key selectedIndex}
    <PoemViewer {poem} />
  {/key}
</main>

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    background-color: #0f0f0f;
    min-height: 100vh;
  }

  main {
    min-height: 100vh;
  }

  .poem-nav {
    display: flex;
    gap: 1rem;
    justify-content: center;
    padding: 1.5rem;
    border-bottom: 1px solid #222;
  }

  .poem-nav button {
    background: none;
    border: none;
    color: #666;
    cursor: pointer;
    font-family: Georgia, serif;
    font-size: 0.9rem;
    font-style: italic;
    padding: 0.25rem 0;
    border-bottom: 1px solid transparent;
    transition: color 0.2s, border-color 0.2s;
  }

  .poem-nav button.active,
  .poem-nav button:hover {
    color: #e8e0d0;
    border-bottom-color: #e8e0d0;
  }
</style>
