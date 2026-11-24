import { pool, query, type Queryable } from "./db";
import { raiseAlert } from "./alerts";

export interface EnqueueOptions {
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
}

/**
 * Coloca uma tarefa na fila. Com dedupeKey, não cria outra igual enquanto
 * a anterior estiver na fila ou em execução (idempotência).
 */
export async function enqueue(type: string, payload: Record<string, unknown>, opts: EnqueueOptions = {}, client?: Queryable) {
  const rows = await query<{ id: string }>(
    `insert into jobs(type, payload, run_at, dedupe_key, max_attempts)
     values ($1, $2, coalesce($3, now()), $4, $5)
     on conflict (dedupe_key) where dedupe_key is not null and status in ('queued','running') do nothing
     returning id`,
    [type, JSON.stringify(payload), opts.runAt ?? null, opts.dedupeKey ?? null, opts.maxAttempts ?? 5],
    client,
  );
  return rows[0]?.id ?? null;
}

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

/** Recupera tarefas travadas (worker caiu no meio da execução). */
async function releaseStale() {
  await query(
    `update jobs set status = 'queued', locked_at = null
     where status = 'running' and locked_at < now() - interval '10 minutes'`,
  );
}

/**
 * Processa até `limit` tarefas prontas. Seguro para vários workers simultâneos
 * (FOR UPDATE SKIP LOCKED). Falhas são reagendadas com backoff exponencial.
 */
export async function runJobs(handlers: Record<string, JobHandler>, limit = 20): Promise<{ done: number; failed: number }> {
  await releaseStale();
  let done = 0, failed = 0;
  for (let i = 0; i < limit; i++) {
    const client = await pool().connect();
    let job: { id: string; type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number } | undefined;
    try {
      await client.query("begin");
      const res = await client.query(
        `select id, type, payload, attempts, max_attempts from jobs
         where status = 'queued' and run_at <= now()
         order by run_at, id for update skip locked limit 1`,
      );
      job = res.rows[0];
      if (job) {
        await client.query("update jobs set status='running', locked_at=now(), attempts=attempts+1 where id=$1", [job.id]);
      }
      await client.query("commit");
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    if (!job) break;

    const handler = handlers[job.type];
    try {
      if (!handler) throw new Error(`Sem handler para a tarefa "${job.type}"`);
      await handler(job.payload);
      await query("update jobs set status='done', finished_at=now(), locked_at=null, last_error=null where id=$1", [job.id]);
      done++;
    } catch (err) {
      const attempts = job.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      const final = attempts >= job.max_attempts || !handler;
      const delaySec = Math.min(3600, 30 * 2 ** (attempts - 1));
      await query(
        `update jobs set status=$2, last_error=$3, locked_at=null,
           run_at = case when $2 = 'queued' then now() + ($4 || ' seconds')::interval else run_at end,
           finished_at = case when $2 = 'failed' then now() else null end
         where id=$1`,
        [job.id, final ? "failed" : "queued", message.slice(0, 2000), String(delaySec)],
      );
      failed++;
      if (final) {
        await raiseAlert({
          severity: "critical",
          type: "job_failed",
          title: `Tarefa automática falhou: ${job.type}`,
          message: message.slice(0, 500),
          entityType: "job",
          entityId: String(job.id),
          dedupeKey: `job_failed:${job.id}`,
        });
      }
    }
  }
  return { done, failed };
}
