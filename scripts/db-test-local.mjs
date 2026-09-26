#!/usr/bin/env node
// Local SHIM run of the database test suite (no Docker / Supabase CLI required).
//
// What it does:
//   1. initdb a throwaway PostgreSQL cluster in a scratch directory and start it on a private
//      127.0.0.1 port (no unix socket), trust auth, UTF8.
//   2. Load tests/db-shim/supabase-shim.sql (Supabase-like roles, grants, auth.* and storage.*).
//   3. Download (once, cached, sha256-pinned) pgTAP and install it into schema `extensions`.
//   4. Apply supabase/migrations/*.sql in order, each in a single transaction.
//   5. Run every supabase/tests/database/*.test.sql with psql (ON_ERROR_STOP) and parse TAP.
//   6. Run parallel-session concurrency checks (two psql processes racing on the same row).
//   7. Stop the cluster and delete the data directory (always, in `finally`).
//
// This is NOT a real Supabase run: PostgREST, GoTrue and the Storage API are not involved.
// `supabase test db` (Docker) and `pnpm test:integration` remain the authoritative checks.
//
// Environment overrides:
//   PG_BIN            directory containing initdb/pg_ctl/psql (default: pg_config --bindir or Homebrew postgresql@16)
//   DB_TEST_SCRATCH   scratch directory for clusters + pgTAP cache (default: <os tmpdir>/learning-suit-db-test)
//   DB_TEST_PORT      TCP port (default: a free ephemeral port)
//   DB_TEST_KEEP=1    keep the data directory for debugging

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const TESTS_DIR = path.join(ROOT, "supabase", "tests", "database");
const SHIM_FILE = path.join(ROOT, "tests", "db-shim", "supabase-shim.sql");
const PGTAP_VERSION = "1.3.3";
const PGTAP_URL = `https://github.com/theory/pgtap/archive/refs/tags/v${PGTAP_VERSION}.tar.gz`;
const PGTAP_SHA256 = "325ea79d0d2515bce96bce43f6823dcd3effbd6c54cb2a4d6c2384fffa3a14c7";
const DB_NAME = "learning_suit_shim";

const USER_A = "11111111-1111-4111-8111-111111111111";

function log(message = "") {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function findPgBin() {
  const candidates = [];
  if (process.env.PG_BIN) candidates.push(process.env.PG_BIN);
  const pgConfig = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  if (pgConfig.status === 0) candidates.push(pgConfig.stdout.trim());
  candidates.push(
    "/opt/homebrew/opt/postgresql@16/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/opt/homebrew/opt/postgresql@15/bin",
    "/usr/local/opt/postgresql@16/bin",
    "/usr/lib/postgresql/16/bin",
    "/usr/lib/postgresql/17/bin",
  );
  for (const dir of candidates) {
    if (["initdb", "pg_ctl", "psql"].every((tool) => existsSync(path.join(dir, tool)))) return dir;
  }
  return fail("PostgreSQL binaries (initdb/pg_ctl/psql) not found. Set PG_BIN to a PostgreSQL 15+ bin directory.");
}

function freePort() {
  if (process.env.DB_TEST_PORT) return Promise.resolve(Number(process.env.DB_TEST_PORT));
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 54329));
    });
  });
}

function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}

function mustRun(command, args, options = {}) {
  const result = runSync(command, args, options);
  if (result.status !== 0) {
    fail(`${path.basename(command)} ${args.join(" ")} failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

async function ensurePgTap(cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  const tarball = path.join(cacheDir, `pgtap-${PGTAP_VERSION}.tar.gz`);
  const built = path.join(cacheDir, `pgtap-${PGTAP_VERSION}.sql`);
  const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

  if (!existsSync(tarball) || sha(tarball) !== PGTAP_SHA256) {
    log(`Downloading pgTAP ${PGTAP_VERSION} from ${PGTAP_URL}`);
    const response = await fetch(PGTAP_URL);
    if (!response.ok) fail(`pgTAP download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== PGTAP_SHA256) fail(`pgTAP tarball sha256 mismatch: expected ${PGTAP_SHA256}, got ${digest}`);
    const partial = `${tarball}.partial`;
    writeFileSync(partial, bytes);
    renameSync(partial, tarball);
  }
  if (!existsSync(built)) {
    const extractDir = mkdtempSync(path.join(cacheDir, "extract-"));
    try {
      mustRun("tar", ["-xzf", tarball, "-C", extractDir]);
      const source = readFileSync(path.join(extractDir, `pgtap-${PGTAP_VERSION}`, "sql", "pgtap.sql.in"), "utf8");
      // Same substitutions as pgTAP's Makefile (no compat patches are needed for PostgreSQL >= 10).
      const numVersion = PGTAP_VERSION.split(".").slice(0, 2).join(".");
      const sql = source
        .replaceAll("MODULE_PATHNAME", "$libdir/pgtap")
        .replaceAll("__OS__", os.platform())
        .replaceAll("__VERSION__", numVersion);
      writeFileSync(built, sql);
    } finally {
      rmSync(extractDir, { recursive: true, force: true });
    }
  }
  return built;
}

/** Parses pgTAP output produced with psql --tuples-only --no-align. */
function parseTap(output) {
  let planned = null;
  let passed = 0;
  const failures = [];
  const diagnostics = [];
  for (const line of output.split(/\r?\n/)) {
    let match;
    if ((match = /^1\.\.(\d+)\s*$/.exec(line))) planned = Number(match[1]);
    else if (/^ok \d+/.test(line)) passed += 1;
    else if (/^not ok \d+/.test(line)) failures.push(line);
    else if (line.startsWith("#")) diagnostics.push(line);
  }
  return { planned, passed, failures, diagnostics };
}

async function main() {
  const pgBin = findPgBin();
  const bin = (tool) => path.join(pgBin, tool);
  const version = mustRun(bin("postgres"), ["--version"]).stdout.trim();
  const major = Number(/(\d+)(?:\.\d+)?/.exec(version.replace(/^[^\d]*/, ""))?.[1] ?? 0);
  if (major < 15) fail(`PostgreSQL 15+ required, found: ${version}`);

  const scratch = path.resolve(process.env.DB_TEST_SCRATCH ?? path.join(os.tmpdir(), "learning-suit-db-test"));
  mkdirSync(scratch, { recursive: true });
  const pgtapSql = await ensurePgTap(path.join(scratch, "cache"));
  const runDir = mkdtempSync(path.join(scratch, "run-"));
  const dataDir = path.join(runDir, "data");
  const logFile = path.join(runDir, "postgres.log");
  const port = await freePort();
  const env = { ...process.env, PGTZ: "UTC", PGCONNECT_TIMEOUT: "10", PGAPPNAME: "learning-suit-db-test" };
  delete env.PGPASSWORD;
  delete env.PGSERVICE;
  const connection = ["-X", "-h", "127.0.0.1", "-p", String(port), "-U", "postgres"];
  const psqlArgs = (database, extra) => [
    ...connection, "-d", database, "-v", "ON_ERROR_STOP=1", "--no-align", "--tuples-only", "--quiet",
    "--pset", "pager=off", ...extra,
  ];
  const psql = (database, extra, options = {}) => runSync(bin("psql"), psqlArgs(database, extra), { env, ...options });
  const mustPsql = (database, extra, label) => {
    const result = psql(database, extra);
    if (result.status !== 0) fail(`${label} failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
    return result;
  };

  let started = false;
  let succeeded = false;
  const stop = () => {
    if (started) {
      runSync(bin("pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"], { env });
      started = false;
    }
  };
  const onSignal = (signal) => {
    stop();
    if (!process.env.DB_TEST_KEEP) rmSync(runDir, { recursive: true, force: true });
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const summary = { files: [], concurrency: [] };
  try {
    log("=== Learning Suit database tests — SHIM RUN (plain PostgreSQL, NOT a Supabase stack) ===");
    log(`${version} | pgTAP ${PGTAP_VERSION} | shim: tests/db-shim/supabase-shim.sql | port ${port}`);

    mustRun(bin("initdb"), ["-D", dataDir, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale=C", "--no-sync"], { env });
    mustRun(bin("pg_ctl"), [
      "-D", dataDir, "-l", logFile, "-w", "-t", "60",
      "-o", `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c fsync=off -c max_connections=20`,
      "start",
    ], { env });
    started = true;

    mustPsql("postgres", ["-c", `create database ${DB_NAME}`], "create database");
    mustPsql(DB_NAME, ["-f", SHIM_FILE], "load supabase shim");
    mustPsql(DB_NAME, ["-c", `alter database ${DB_NAME} set search_path = "$user", public, extensions`], "set search_path");
    const pgtap = runSync(bin("psql"), psqlArgs(DB_NAME, ["-f", pgtapSql]), {
      env: { ...env, PGOPTIONS: "-c search_path=extensions -c client_min_messages=warning" },
    });
    if (pgtap.status !== 0) fail(`pgTAP install failed:\n${pgtap.stderr}`);

    const migrations = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
    if (!migrations.length) fail("No migrations found in supabase/migrations");
    for (const migration of migrations) {
      mustPsql(DB_NAME, ["--single-transaction", "-f", path.join(MIGRATIONS_DIR, migration)], `migration ${migration}`);
    }
    log(`Migrations applied: ${migrations.join(", ")}`);
    log("");

    const testFiles = readdirSync(TESTS_DIR).filter((name) => name.endsWith(".sql")).sort();
    if (!testFiles.length) fail("No pgTAP tests found in supabase/tests/database");
    const preparedDir = path.join(runDir, "tests");
    mkdirSync(preparedDir);
    for (const name of testFiles) {
      // pgTAP is preinstalled into `extensions` as plain SQL (no extension control file in a Homebrew
      // cluster), so the `create extension ... pgtap` line the Supabase CLI flow uses is neutralised.
      const source = readFileSync(path.join(TESTS_DIR, name), "utf8").replace(
        /^\s*create\s+extension\s+if\s+not\s+exists\s+pgtap\b[^;]*;/gim,
        "-- [shim] pgTAP preinstalled in schema extensions",
      );
      const prepared = path.join(preparedDir, name);
      writeFileSync(prepared, source);
      const result = psql(DB_NAME, ["-f", prepared]);
      const tap = parseTap(result.stdout);
      const ok = result.status === 0 && tap.planned !== null && tap.failures.length === 0
        && tap.passed === tap.planned && !tap.diagnostics.some((line) => /Looks like/i.test(line));
      summary.files.push({ name, ok, ...tap, status: result.status, stderr: result.stderr });
      log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(40)} ${tap.passed}/${tap.planned ?? "?"} ok`);
      if (!ok) {
        for (const line of tap.failures) log(`      ${line}`);
        for (const line of tap.diagnostics) log(`      ${line}`);
        if (result.status !== 0) log(`      psql exit ${result.status}: ${result.stderr.trim().split("\n").slice(-6).join("\n      ")}`);
      }
    }

    log("");
    log("Concurrency checks (two psql sessions racing on the same project row):");
    summary.concurrency = await runConcurrencyChecks({ bin, psqlArgs, env, mustPsql, workDir: runDir });
    for (const check of summary.concurrency) {
      log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
    }

    const totalPassed = summary.files.reduce((sum, file) => sum + file.passed, 0);
    const totalPlanned = summary.files.reduce((sum, file) => sum + (file.planned ?? 0), 0);
    const totalFailed = summary.files.reduce((sum, file) => sum + file.failures.length, 0);
    const filesOk = summary.files.every((file) => file.ok);
    const concurrencyOk = summary.concurrency.every((check) => check.ok);
    log("");
    log(`Summary (SHIM): ${summary.files.filter((f) => f.ok).length}/${summary.files.length} pgTAP files passed, `
      + `${totalPassed}/${totalPlanned} assertions ok, ${totalFailed} not ok; `
      + `${summary.concurrency.filter((c) => c.ok).length}/${summary.concurrency.length} concurrency checks passed.`);
    log("Real Supabase evidence still requires: supabase start && supabase test db && pnpm test:integration");
    succeeded = filesOk && concurrencyOk;
    if (!succeeded) {
      const serverLog = existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").filter((l) => /ERROR|FATAL|PANIC/.test(l)) : [];
      if (serverLog.length) {
        log("");
        log("Server log errors (last 20):");
        for (const line of serverLog.slice(-20)) log(`  ${line}`);
      }
    }
  } finally {
    stop();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    if (process.env.DB_TEST_KEEP) log(`Kept ${runDir}`);
    else rmSync(runDir, { recursive: true, force: true });
  }
  process.exitCode = succeeded ? 0 : 1;
}

function spawnPsql(bin, args, env) {
  return new Promise((resolve) => {
    const child = spawn(bin("psql"), args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function asUser(uid, statement) {
  return [
    "begin;",
    "set local role authenticated;",
    `set local request.jwt.claims to '{"sub":"${uid}","role":"authenticated"}';`,
    statement,
    "select pg_sleep(1.0);",
    "commit;",
  ].join("\n");
}

function documentFor(slideId) {
  return JSON.stringify({
    schemaVersion: 1,
    slides: [{ id: slideId, name: "Concurrency", background: "#FFFFFF", nodes: [] }],
    assets: {},
  });
}

let raceCounter = 0;
async function race({ bin, psqlArgs, env, workDir }, scripts) {
  const files = scripts.map((script) => {
    raceCounter += 1;
    const file = path.join(workDir, `race-${raceCounter}.sql`);
    writeFileSync(file, `${script}\n`);
    return file;
  });
  const results = await Promise.all(files.map((file) => spawnPsql(bin, psqlArgs(DB_NAME, ["-f", file]), env)));
  return results.map((result) => {
    const line = result.stdout.split("\n").find((l) => l.trim().startsWith("{"));
    return { status: result.status, json: line ? JSON.parse(line) : null, stderr: result.stderr };
  });
}

async function runConcurrencyChecks(context) {
  const { mustPsql } = context;
  const project = (n) => `ccccccc${n}-0000-4000-8000-000000000001`;
  const slide = "5c000000-0000-4000-8000-000000000001";
  const mutation = (n) => `3e000000-0000-4000-8000-00000000000${n}`;
  const doc = documentFor(slide).replaceAll("'", "''");
  mustPsql(DB_NAME, ["-c", `insert into auth.users (id, email) values ('${USER_A}', 'concurrency-a@example.test')`], "concurrency setup");
  const checks = [];
  const readRow = (id) => {
    const row = mustPsql(DB_NAME, ["-c", `select revision || '|' || coalesce(last_mutation_id::text, '') from public.projects where id = '${id}'`], "read row");
    return row.stdout.trim();
  };

  // 1. Two devices save on the same expected revision at the same time (PST-09).
  for (const n of [1, 2, 3]) {
    mustPsql(DB_NAME, ["-c", asUser(USER_A, `select public.reserve_project('${project(n)}', 'Concurrency ${n}', '${slide}');`).replace("select pg_sleep(1.0);\n", "")], "reserve");
  }
  {
    const results = await race(context, [
      asUser(USER_A, `select public.save_project('${project(1)}', 0, '${mutation(1)}', 'Device 1', '${doc}'::jsonb)::text;`),
      asUser(USER_A, `select public.save_project('${project(1)}', 0, '${mutation(2)}', 'Device 2', '${doc}'::jsonb)::text;`),
    ]);
    const statuses = results.map((r) => r.json?.status).sort();
    const conflict = results.find((r) => r.json?.status === "conflict")?.json;
    const winner = results.find((r) => r.json?.status === "saved")?.json;
    const row = readRow(project(1));
    const ok = results.every((r) => r.status === 0) && statuses.join(",") === "conflict,saved"
      && conflict?.currentRevision === 1 && row === `1|${winner?.mutationId}`;
    checks.push({
      name: "PST-09 parallel saves on revision 0",
      ok,
      detail: `${JSON.stringify(results.map((r) => r.json ?? r.stderr.trim()))} -> row revision|mutation = ${row}`,
    });
  }

  // 2. A retry of the same mutation racing the original (lost response + immediate retry, PST-07).
  {
    const results = await race(context, [
      asUser(USER_A, `select public.save_project('${project(2)}', 0, '${mutation(3)}', 'Retry', '${doc}'::jsonb)::text;`),
      asUser(USER_A, `select public.save_project('${project(2)}', 0, '${mutation(3)}', 'Retry', '${doc}'::jsonb)::text;`),
    ]);
    const row = readRow(project(2));
    const ok = results.every((r) => r.status === 0 && r.json?.status === "saved" && r.json?.revision === 1)
      && row === `1|${mutation(3)}`;
    checks.push({
      name: "PST-07 same mutation retried in parallel",
      ok,
      detail: `${JSON.stringify(results.map((r) => (r.json ? { status: r.json.status, revision: r.json.revision } : r.stderr.trim())))} -> row ${row}`,
    });
  }

  // 3. Two reservations of the same new id at the same time (unique_violation path of reserve_project).
  {
    const fresh = "ccccccc9-0000-4000-8000-000000000001";
    const results = await race(context, [
      asUser(USER_A, `select public.reserve_project('${fresh}', 'Race', '${slide}')::text;`),
      asUser(USER_A, `select public.reserve_project('${fresh}', 'Race', '${slide}')::text;`),
    ]);
    const statuses = results.map((r) => r.json?.status).sort();
    const ok = results.every((r) => r.status === 0) && statuses.join(",") === "existing,reserved";
    checks.push({
      name: "reserve_project raced on one id",
      ok,
      detail: JSON.stringify(results.map((r) => r.json?.status ?? r.stderr.trim())),
    });
  }

  // 4. Tombstone racing a save on the same expected revision: exactly one wins, no revival.
  {
    const results = await race(context, [
      asUser(USER_A, `select public.mark_project_deleted('${project(3)}', 0, '${mutation(4)}')::text;`),
      asUser(USER_A, `select public.save_project('${project(3)}', 0, '${mutation(5)}', 'Late save', '${doc}'::jsonb)::text;`),
    ]);
    const statuses = results.map((r) => r.json?.status).sort();
    const deleted = mustPsql(DB_NAME, ["-c", `select (deleted_at is not null)::text from public.projects where id = '${project(3)}'`], "read tombstone").stdout.trim();
    const deleteWon = results[0].json?.status === "saved";
    const ok = results.every((r) => r.status === 0) && statuses.join(",") === (deleteWon ? "saved,unavailable" : "conflict,saved")
      && deleted === String(deleteWon);
    checks.push({
      name: "tombstone vs save on revision 0",
      ok,
      detail: `${JSON.stringify(results.map((r) => r.json?.status ?? r.stderr.trim()))} -> deleted=${deleted}`,
    });
  }
  return checks;
}

main().catch((error) => {
  process.stderr.write(`\ndb-test-local: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
