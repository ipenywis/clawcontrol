#!/usr/bin/env node

// Thin wrapper so npm correctly registers the "clawcontrol" binary.
// The actual CLI is powered by Bun (required by @opentui/core), so we
// re-exec with bun pointing at the bundled dist/index.js.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);

// ── Helpers ──────────────────────────────────────────────────────────

const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const currentVersion = pkg.version;

/** Compare two semver strings. Returns -1, 0, or 1. */
function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/** Fetch the latest version from the npm registry. Returns version string or null. */
async function fetchLatestVersion(timeoutMs = 3000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch("https://registry.npmjs.org/clawcontrol/latest", {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return data.version ?? null;
  } catch {
    return null;
  }
}

/** Run bun add -g clawcontrol@latest. Returns true on success. */
function performUpdate() {
  try {
    execFileSync("bun", ["add", "-g", "clawcontrol@latest"], {
      stdio: "pipe",
    });
    // Verify the new version by re-reading package.json from disk
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "../package.json");
    const newPkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    console.log(`\x1b[32m[update] Updated to v${newPkg.version}\x1b[0m`);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") {
      console.error(
        "\x1b[31m[update] Update failed: bun is not installed.\x1b[0m\n" +
          "  Install it: curl -fsSL https://bun.sh/install | bash"
      );
    } else {
      const detail = e.stderr ? e.stderr.toString().trim() : e.message;
      console.error(`\x1b[31m[update] Update failed: ${detail}\x1b[0m`);
    }
    return false;
  }
}

// ── --version ────────────────────────────────────────────────────────

if (args.includes("--version") || args.includes("-v")) {
  console.log(`clawcontrol v${currentVersion}`);
  process.exit(0);
}

// ── --help ───────────────────────────────────────────────────────────

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
clawcontrol v${currentVersion}
${pkg.description}

Usage:
  clawcontrol            Launch the interactive TUI
  clawcontrol --help     Show this help message
  clawcontrol --version  Show the version number
  clawcontrol --update   Update to the latest version

Options:
  -h, --help     Show this help message
  -v, --version  Show the version number
  -u, --update   Update clawcontrol to the latest version

Environment:
  CLAWCONTROL_SKIP_UPDATE=1   Skip the automatic update check on startup

Documentation & source:
  https://github.com/ipenywis/clawcontrol
`);
  process.exit(0);
}

// ── --update (manual) ────────────────────────────────────────────────

if (args.includes("--update") || args.includes("-u")) {
  console.log("\x1b[36m[update] Checking for updates...\x1b[0m");
  const latest = await fetchLatestVersion(10000); // generous 10s timeout for manual
  if (latest === null) {
    console.error("\x1b[31m[update] Could not reach npm registry.\x1b[0m");
    process.exit(1);
  }
  if (compareSemver(currentVersion, latest) >= 0) {
    console.log(`\x1b[32m[update] Already up to date (v${currentVersion})\x1b[0m`);
    process.exit(0);
  }
  console.log(`\x1b[36m[update] New version available: v${currentVersion} -> v${latest}\x1b[0m`);
  console.log("\x1b[36m[update] Updating clawcontrol...\x1b[0m");
  const ok = performUpdate();
  process.exit(ok ? 0 : 1);
}

// ── Auto-update on startup ───────────────────────────────────────────

if (process.env.CLAWCONTROL_SKIP_UPDATE !== "1") {
  const latest = await fetchLatestVersion(3000);
  if (latest !== null && compareSemver(currentVersion, latest) < 0) {
    console.log(`\x1b[36m[update] New version available: v${currentVersion} -> v${latest}\x1b[0m`);
    console.log("\x1b[36m[update] Updating clawcontrol...\x1b[0m");
    const ok = performUpdate();
    if (ok) {
      console.log("\x1b[36m[update] Restarting with updated version...\x1b[0m");
      try {
        execFileSync(process.argv[0], process.argv.slice(1), {
          stdio: "inherit",
          env: { ...process.env, CLAWCONTROL_SKIP_UPDATE: "1" },
        });
        process.exit(0);
      } catch (e) {
        process.exit(e.status ?? 1);
      }
    }
    // If update failed, fall through and run the current version
  }
}

// ── Launch the TUI via bun ───────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = resolve(__dirname, "../dist/index.js");

try {
  execFileSync("bun", [script, ...args], {
    stdio: "inherit",
  });
} catch (e) {
  if (e.code === "ENOENT") {
    console.error(
      "\n  ClawControl requires the Bun runtime." +
        "\n  Install it: curl -fsSL https://bun.sh/install | bash\n"
    );
    process.exit(1);
  }
  // Forward the child's exit code
  process.exit(e.status ?? 1);
}
