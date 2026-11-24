import "./load-env";
import { enqueue } from "../src/lib/jobs";
import { processQueue } from "../src/modules/worker/handlers";
import { closePool } from "../src/lib/db";

/**
 * Worker da fila: processa tarefas continuamente.
 * Uso: npm run worker            (contínuo)
 *      npm run worker -- --once  (uma passada, útil em cron)
 */
const once = process.argv.includes("--once");
let stop = false;
process.on("SIGINT", () => (stop = true));
process.on("SIGTERM", () => (stop = true));

async function main() {
  let lastPeriodic = 0;
  do {
    if (Date.now() - lastPeriodic > 5 * 60 * 1000) {
      await enqueue("maintenance.periodic", {}, { dedupeKey: "maintenance.periodic" });
      lastPeriodic = Date.now();
    }
    const r = await processQueue(50);
    if (r.done || r.failed) console.log(`[worker] concluídas: ${r.done}, falhas: ${r.failed}`);
    if (!once) await new Promise((res) => setTimeout(res, r.done ? 200 : 3000));
  } while (!once && !stop);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closePool);
