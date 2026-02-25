<script lang="ts">
  import { PUBLIC_CONVEX_URL } from "$env/static/public"
  import { setupConvex } from "$lib/index.js"
  import { page } from "$app/state"
  import type { Snippet } from "svelte"
  import "../app.css"

  setupConvex(PUBLIC_CONVEX_URL)

  let { children }: { children: Snippet } = $props()

  const links = [
    { href: "/demo/server", label: "Server demo" },
    { href: "/demo/client", label: "Client demo" },
    { href: "/demo/query", label: "Query demo" },
    { href: "/demo/auth", label: "Auth demo" },
  ]
</script>

<svelte:head>
  <title>convex-sveltekit</title>
  <meta
    name="description"
    content="SvelteKit-native Convex integration with real-time queries, form spreading, and SSR-to-live transport."
  />
</svelte:head>

<nav class="site-nav">
  <a href="/" class="site-logo"
    ><img src="/favicon.svg" alt="" class="site-icon" />convex-sveltekit</a
  >
  <div class="site-links">
    {#each links as link (link.href)}
      <a href={link.href} class:active={page.url.pathname.startsWith(link.href)}>{link.label}</a>
    {/each}
  </div>
</nav>

{@render children()}

<style>
  .site-nav {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    max-width: 52rem;
    margin: 0 auto;
    padding: 0.75rem 1.5rem;
    font-size: 0.85rem;
  }
  .site-logo {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-weight: 700;
    color: var(--text);
    text-decoration: none;
    margin-right: auto;
  }
  .site-icon {
    width: 1.1rem;
    height: 1.1rem;
  }
  .site-links {
    display: flex;
    gap: 1rem;
  }
  .site-links a {
    color: var(--text-muted);
    text-decoration: none;
    font-weight: 500;
  }
  .site-links a:hover {
    color: var(--text);
    text-decoration: none;
  }
  .site-links a.active {
    color: var(--accent);
  }
</style>
