#!/usr/bin/env node
// Runs tests/integration against a real local Supabase stack (REST/RPC/Storage as users A, B, anon).
// Refuses to start without the stack's connection details, and refuses non-local URLs unless
// explicitly allowed, because the suite creates and deletes fixture users with the service role.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED = ["SUPABASE_TEST_URL", "SUPABASE_TEST_PUBLISHABLE_KEY", "SUPABASE_TEST_SERVICE_ROLE_KEY"];
const missing = REQUIRED.filter((name) => !process.env[name]);

if (missing.length) {
  console.error(`pnpm test:integration needs a running local Supabase stack. Missing: ${missing.join(", ")}

  1. Install Docker (running) and the Supabase CLI:
       https://supabase.com/docs/guides/local-development/cli/getting-started
  2. From the repository root start the stack (applies supabase/migrations, creates the private bucket):
       supabase start
  3. Read the local credentials:
       supabase status -o env
  4. Export them (local values only; never production keys):
       export SUPABASE_TEST_URL=<API_URL, e.g. http://127.0.0.1:54321>
       export SUPABASE_TEST_PUBLISHABLE_KEY=<PUBLISHABLE_KEY or ANON_KEY>
       export SUPABASE_TEST_SERVICE_ROLE_KEY=<SECRET_KEY or SERVICE_ROLE_KEY>   # fixture users only, never assertions
  5. Run again:
       pnpm test:integration

Database-only checks: supabase test db (Docker) or node scripts/db-test-local.mjs (plain PostgreSQL shim).`);
  process.exit(1);
}

let host;
try {
  host = new URL(process.env.SUPABASE_TEST_URL).hostname;
} catch {
  console.error(`SUPABASE_TEST_URL is not a valid URL: ${process.env.SUPABASE_TEST_URL}`);
  process.exit(1);
}
const local = ["127.0.0.1", "localhost", "::1", "[::1]", "host.docker.internal"].includes(host);
if (!local && process.env.LEARNING_SUIT_ALLOW_REMOTE_INTEGRATION !== "1") {
  console.error(`Refusing to run integration tests against non-local host "${host}".
The suite creates/deletes users with the service role. Set LEARNING_SUIT_ALLOW_REMOTE_INTEGRATION=1 only for a disposable test project.`);
  process.exit(1);
}

const vitest = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(process.execPath, [vitest, "run", "--config", "vitest.integration.config.ts", ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
