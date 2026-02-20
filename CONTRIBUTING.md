# Contributing

Thanks for your interest in `convex-sveltekit`!

## Setup

```bash
git clone https://github.com/axel-rock/convex-sveltekit.git
cd convex-sveltekit
pnpm install
cp .env.example .env   # fill in your Convex URL to run the demo
pnpm dev
```

## Important: `src/lib/` syncs from cobl

The library source (`src/lib/`) is synced from a private repo ([cobl](https://github.com/axel-rock/cobl)) where it's battle-tested. PRs that modify `src/lib/` should be discussed in an issue first so the change can be coordinated.

Everything else — tests, CI, docs, demo routes, scripts — lives outside `src/lib/` and is fair game.

## Running checks

```bash
pnpm test       # unit tests (vitest)
pnpm check      # svelte-check
pnpm lint       # eslint
pnpm package    # build + dist validation
```

## Pull requests

- Fork, branch, PR against `main`
- Keep changes focused — one concern per PR
- Include a brief description of _why_, not just _what_
