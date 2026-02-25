#!/usr/bin/env bash
# Verifies the published package is consumable by a fresh SvelteKit project.
# Packs a tarball, installs it in a temp project, imports every public export,
# and runs svelte-check. Catches broken/missing exports before users do.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Building package..."
(cd "$ROOT" && pnpm package)

echo "==> Packing tarball..."
TARBALL="$(cd "$ROOT" && npm pack --pack-destination "$TMP" 2>/dev/null | tail -1)"

echo "==> Scaffolding test project in $TMP..."
cd "$TMP"

cat > package.json << 'PKGJSON'
{
  "name": "test-consumer",
  "private": true,
  "type": "module",
  "devDependencies": {
    "@sveltejs/kit": "^2.51.0",
    "@sveltejs/vite-plugin-svelte": "^6.0.0",
    "svelte": "^5.29.0",
    "svelte-check": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^7.0.0"
  }
}
PKGJSON

cat > tsconfig.json << 'TSCONF'
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["svelte"]
  },
  "include": ["src/**/*.ts"]
}
TSCONF

mkdir -p src

cat > src/check-exports.ts << 'EXPORTS'
// Every public export from convex-sveltekit — if any are missing, svelte-check fails.
import type { ConvexQueryResult } from "convex-sveltekit"
import type { ConvexForm } from "convex-sveltekit"
import type { ConvexCommand } from "convex-sveltekit"
import type { ConvexUserData } from "convex-sveltekit"

import {
  initConvex,
  setupConvex,
  getConvexClient,
  getConvexUrl,
  useConvexClient,
  convexQuery,
  createDetachedQuery,
  convexForm,
  convexCommand,
  convexLoad,
  ConvexLoadResult,
  encodeConvexLoad,
  decodeConvexLoad,
  serverQuery,
  serverMutation,
  serverAction,
  setupConvexAuth,
  useConvexAuth,
  convexUser,
  ConvexUserResult,
  encodeConvexUser,
  decodeConvexUser,
} from "convex-sveltekit"

// Ensure values are real (not just types)
console.log(typeof initConvex, typeof ConvexLoadResult, typeof convexUser)
EXPORTS

echo "==> Installing dependencies + tarball..."
npm install --no-audit --no-fund 2>&1 | tail -3
npm install "$TMP/$TARBALL" --no-audit --no-fund 2>&1 | tail -3

echo "==> Running tsc..."
npx tsc --noEmit

echo "==> Package integration test passed!"
