// Locks de áreas compartidas, guardados como issues de GitHub con la etiqueta "lock".
//   node scripts/harness/lock.mjs take <área> [motivo]
//   node scripts/harness/lock.mjs release <área>
//   node scripts/harness/lock.mjs list
import { TEAM, gh, ghLogin, openLocks, lockTitle } from "./lib.mjs";

const MAX_MIN = 30;
const [cmd, areaId, ...rest] = process.argv.slice(2);
const shared = TEAM.areas.filter((a) => a.shared).map((a) => a.id);
const age = (iso) => Math.round((Date.now() - new Date(iso).getTime()) / 60000);

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

try {
  if (cmd === "list" || !cmd) {
    const locks = openLocks();
    if (!locks.length) console.log("No hay locks abiertos.");
    for (const l of locks) {
      const m = age(l.createdAt);
      console.log(`${l.area.padEnd(12)} @${l.holder.padEnd(20)} ${String(m).padStart(4)} min${m > MAX_MIN ? "  ⚠ pasa de " + MAX_MIN + " min" : ""}  ${l.url}`);
    }
    process.exit(0);
  }

  if (!shared.includes(areaId)) fail(`"${areaId}" no es un área compartida. Áreas con lock: ${shared.join(", ")}.`);
  const me = ghLogin();
  const current = openLocks().find((l) => l.area === areaId);

  if (cmd === "take") {
    if (current?.holder === me) {
      console.log(`Ya tienes el lock de "${areaId}": ${current.url}`);
      process.exit(0);
    }
    if (current) fail(`El lock de "${areaId}" lo tiene @${current.holder} desde hace ${age(current.createdAt)} min: ${current.url}`);
    const body = `Lock del área compartida \`${areaId}\` tomado por @${me}.\n\nMotivo: ${rest.join(" ") || "(sin motivo)"}\n\nSe libera al fusionar el PR, como mucho ${MAX_MIN} minutos después de tomarlo: \`node scripts/harness/lock.mjs release ${areaId}\``;
    const url = gh(["issue", "create", "--title", lockTitle(areaId), "--label", TEAM.labels.lock, "--assignee", "@me", "--body", body]);
    // Dos personas pueden crear el issue a la vez: gana el número más bajo.
    const race = openLocks().filter((l) => l.area === areaId).sort((a, b) => a.number - b.number);
    if (race.length > 1 && race[0].holder !== me) {
      const mine = race.find((l) => l.holder === me);
      if (mine) gh(["issue", "close", String(mine.number), "--comment", `Empate con #${race[0].number}; gana el primero.`]);
      fail(`@${race[0].holder} tomó el lock de "${areaId}" un instante antes: ${race[0].url}`);
    }
    console.log(`✔ Lock de "${areaId}" tomado: ${url}`);
  } else if (cmd === "release") {
    if (!current) fail(`No hay lock abierto de "${areaId}".`);
    if (current.holder !== me) fail(`El lock de "${areaId}" es de @${current.holder}; solo esa persona lo libera.`);
    gh(["issue", "close", String(current.number), "--comment", "Liberado."]);
    console.log(`✔ Lock de "${areaId}" liberado.`);
  } else {
    fail(`Comando desconocido "${cmd}". Usa take, release o list.`);
  }
} catch (e) {
  fail(e.message);
}
