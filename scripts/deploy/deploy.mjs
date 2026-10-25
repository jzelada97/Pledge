#!/usr/bin/env node
// Despliegue de la plataforma en testnet (P2). Idempotente: deployments/testnet.json es el estado.
//   1. Compila los wasm (stellar contract build) y comprueba FAC-1: sin upgrade/sweep/rescue.
//   2. Sube el wasm del escrow y lo añade a escrowWasmHashesAllowed.
//   3. Factory: la despliega si no existe (o con --fresh); si existe y el wasm del escrow cambió,
//      set_escrow_wasm_hash (sube config_version: las altas en curso tendrán que releerla, FAC-6).
//   4. Mock-vault de la estrategia simulada si aún no tiene dirección.
//   5. Registra las estrategias que falten (add_strategy → set_strategy_enabled) y la de por defecto.
//   6. Verifica (config_version, funding_allowed, trustline de la tesorería) y escribe deployments.
// Firma con identidades de la CLI (`stellar keys`); en el repo no hay secretos.
// Uso: node scripts/deploy/deploy.mjs [--no-build] [--fresh]
//   DEPLOY_SOURCE (fianzas-admin), STELLAR_NETWORK (testnet), MOCK_RATE_BPS (600).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NETWORK = process.env.STELLAR_NETWORK ?? "testnet";
const SOURCE = process.env.DEPLOY_SOURCE ?? "fianzas-admin";
const MOCK_RATE_BPS = Number(process.env.MOCK_RATE_BPS ?? 600);
const DEP_PATH = join(ROOT, "deployments", `${NETWORK}.json`);
const WASM = (name) => join(ROOT, "target", "wasm32v1-none", "release", `${name}.wasm`);
const args = new Set(process.argv.slice(2));

// Config de demo (INTERFACES § 3, comentarios de GlobalConfig). Producción: 30 días y vault_manager.
const DEMO = { timeoutSecs: 120, reviewTimeoutSecs: 300, stopBondMin: "100000000", stopBondBps: 500 };
// Funciones que no pueden existir (security FAC-1 y § 13: nada de upgrade ni barridos).
const FORBIDDEN_FNS = { factory: ["upgrade"], escrow: ["upgrade", "sweep", "rescue"] };

const dep = JSON.parse(readFileSync(DEP_PATH, "utf8"));

function stellar(argv, { quiet = false } = {}) {
  const out = execFileSync("stellar", argv, { encoding: "utf8", stdio: ["ignore", "pipe", quiet ? "pipe" : "inherit"] });
  return out.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
}
const net = ["--network", NETWORK];
const invoke = (id, fn, fnArgs = {}, { send = true } = {}) => {
  const argv = ["contract", "invoke", "--id", id, "--source", SOURCE, ...net];
  if (!send) argv.push("--send=no");
  argv.push("--", fn);
  for (const [k, v] of Object.entries(fnArgs)) argv.push(`--${k}`, typeof v === "string" ? v : JSON.stringify(v));
  const out = stellar(argv, { quiet: !send });
  try { return JSON.parse(out); } catch { return out; }
};
const read = (id, fn, fnArgs) => invoke(id, fn, fnArgs, { send: false });
const step = (msg) => console.log(`\n== ${msg}`);

async function latestLedger() {
  const res = await fetch(dep.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" }),
  });
  return (await res.json()).result.sequence;
}

function checkInterface(name) {
  const iface = execFileSync("stellar", ["contract", "info", "interface", "--wasm", WASM(name), "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const fns = JSON.parse(iface).filter((entry) => entry.function_v0).map((entry) => entry.function_v0.name);
  const bad = fns.filter((f) => FORBIDDEN_FNS[name].includes(f));
  if (fns.length === 0) throw new Error(`no se pudo leer la interfaz de ${name}.wasm`);
  if (bad.length) throw new Error(`${name}.wasm expone funciones prohibidas: ${bad.join(", ")}`);
  console.log(`${name}: ${fns.length} funciones, ninguna prohibida`);
}

function globalConfig() {
  return {
    token: dep.token,
    treasury: dep.treasury,
    staff: dep.staff,
    platform_fee_bps: dep.platformFeeBps,
    tw_fee_bps: dep.twFeeBps,
    tw_fee_receiver: dep.twFeeReceiver,
    timeout_secs: DEMO.timeoutSecs,
    review_timeout_secs: DEMO.reviewTimeoutSecs,
    stop_bond_min: DEMO.stopBondMin,
    stop_bond_bps: DEMO.stopBondBps,
    tenant_yield_bps: dep.tenantYieldBps,
    vault_manager: null, // testnet: None (INTERFACES § 3)
  };
}

function strategyArg(s) {
  const noYield = s.kind === "noyield";
  return {
    id: s.id,
    kind: noYield ? "NoYield" : "DeFindexVault",
    vault: s.vault,
    asset: dep.token,
    asset_name: s.assetName,
    defindex_strategy: s.defindexStrategy ?? null,
    apy_pool: s.apyPool ?? null,
    risk: { noyield: "NoYield", standard: "Standard", high: "High" }[s.risk],
    simulated: s.simulated,
    enabled: false,
    max_vault_fee_bps: noYield ? 0 : s.maxVaultFeeBps,
  };
}

async function treasuryHasTrustline() {
  const horizon = NETWORK === "testnet" ? "https://horizon-testnet.stellar.org" : null;
  if (!horizon) return null;
  const res = await fetch(`${horizon}/accounts/${dep.treasury}`);
  if (!res.ok) return false;
  const acc = await res.json();
  return acc.balances.some((b) => b.asset_code === dep.tokenCode && b.asset_issuer === dep.tokenIssuer);
}

// ---------------------------------------------------------------------------------------------

const admin = stellar(["keys", "address", SOURCE], { quiet: true });
if (admin !== dep.admin) throw new Error(`${SOURCE} es ${admin}, pero deployments.admin es ${dep.admin}`);

if (!args.has("--no-build")) {
  step("stellar contract build");
  execFileSync("stellar", ["contract", "build"], { cwd: ROOT, stdio: "inherit" });
}
step("FAC-1: interfaz de los wasm");
checkInterface("factory");
checkInterface("escrow");

step("wasm del escrow");
const escrowHash = stellar(["contract", "upload", "--wasm", WASM("escrow"), "--source", SOURCE, ...net], { quiet: true });
console.log(`escrow wasm: ${escrowHash}`);
dep.escrowWasmHashesAllowed = [...new Set([...(dep.escrowWasmHashesAllowed ?? []), escrowHash])];

step("factory");
if (!dep.factory || args.has("--fresh")) {
  const start = await latestLedger();
  dep.factory = stellar([
    "contract", "deploy", "--wasm", WASM("factory"), "--source", SOURCE, ...net, "--alias", "fianzas-factory",
    "--", "--admin", dep.admin, "--escrow_wasm_hash", escrowHash, "--config", JSON.stringify(globalConfig()),
  ], { quiet: true });
  dep.startLedger = start;
  console.log(`factory desplegada: ${dep.factory} (desde el ledger ${start})`);
} else if (read(dep.factory, "escrow_wasm_hash") !== escrowHash) {
  invoke(dep.factory, "set_escrow_wasm_hash", { hash: escrowHash });
  console.log(`factory ${dep.factory}: escrow wasm actualizado`);
} else {
  console.log(`factory ${dep.factory}: sin cambios`);
}
dep.escrowWasmHash = escrowHash;

step("mock-vault");
for (const s of dep.strategies.filter((s) => s.simulated && s.kind === "defindex" && !s.vault)) {
  s.vault = stellar([
    "contract", "deploy", "--wasm", WASM("mock_vault"), "--source", SOURCE, ...net, "--alias", `fianzas-${s.id}`,
    "--", "--admin", dep.admin, "--asset", dep.token,
  ], { quiet: true });
  invoke(s.vault, "set_rate_bps", { rate_bps: MOCK_RATE_BPS });
  const [vf, pf] = read(s.vault, "get_fees");
  Object.assign(s, { vaultManager: dep.admin, vaultFeeBps: vf, protocolFeeBps: pf });
  console.log(`${s.id}: mock-vault ${s.vault} al ${MOCK_RATE_BPS / 100} % anual simulado`);
}

step("estrategias");
const registered = new Set(read(dep.factory, "strategies").map((s) => s.id));
for (const s of dep.strategies) {
  if (!s.vault && s.kind !== "noyield") throw new Error(`${s.id} no tiene vault`);
  if (!registered.has(s.id)) {
    invoke(dep.factory, "add_strategy", { s: strategyArg(s) });
    invoke(dep.factory, "set_strategy_enabled", { id: s.id, enabled: true });
    console.log(`${s.id}: registrada y habilitada`);
  } else {
    console.log(`${s.id}: ya registrada`);
  }
}
const def = dep.strategies.find((s) => s.default);
let currentDefault = null;
try { currentDefault = read(dep.factory, "default_strategy").id; } catch { /* sin default todavía */ }
if (def && currentDefault !== def.id) {
  invoke(dep.factory, "set_default_strategy", { id: def.id });
  console.log(`por defecto: ${def.id}`);
}

step("verificación");
const version = read(dep.factory, "config_version");
console.log(`config_version: ${version}`);
for (const s of dep.strategies) console.log(`funding_allowed(${s.id}): ${read(dep.factory, "funding_allowed", { strategy_id: s.id })}`);
const trust = await treasuryHasTrustline();
if (trust === false) console.warn(`⚠ la tesorería ${dep.treasury} no tiene trustline de ${dep.tokenCode}: créala con scripts/fund antes del primer settle`);

dep.updatedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
writeFileSync(DEP_PATH, JSON.stringify(dep, null, 2) + "\n");
console.log(`\n== listo: ${DEP_PATH}`);
