#!/usr/bin/env node
/**
 * lyra-minions-jobs — thin CLI over the Minions queue.
 * Commands: submit | work | list | show | cancel | smoke | ensure-schema
 */
import { PgEngine } from './engine.js';
import { MinionQueue } from './queue.js';
import { MinionWorker } from './worker.js';
import { shellHandler } from './handlers/shell.js';
import type { MinionHandler } from './types.js';

const HANDLERS: Record<string, MinionHandler> = {
  shell: shellHandler,
};

function usage(): never {
  console.error(`Usage:
  lyra-minions-jobs submit <name> [--cmd <shell>] [--data <json>] [--timeout <ms>] [--max-attempts <n>] [--idempotency-key <k>]
  lyra-minions-jobs work [--concurrency <n>] [--queue <name>]
  lyra-minions-jobs list [--status <s>] [--limit <n>]
  lyra-minions-jobs show <id>
  lyra-minions-jobs cancel <id>
  lyra-minions-jobs smoke
  lyra-minions-jobs ensure-schema

Env:
  LYRA_MINIONS_DB_URL=postgres://user:pass@host:port/db   (fallback: DATABASE_URL)`);
  process.exit(2);
}

function parseFlags(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true';
      flags[key] = val;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) usage();

  const engine = new PgEngine();
  const queue = new MinionQueue(engine);

  try {
    switch (cmd) {
      case 'ensure-schema': {
        await queue.ensureSchema();
        console.log('ok: schema present');
        break;
      }

      case 'submit': {
        const { positional, flags } = parseFlags(rest);
        const name = positional[0];
        if (!name) usage();
        const data = flags.cmd
          ? { cmd: flags.cmd, cwd: flags.cwd ?? process.cwd() }
          : flags.data ? JSON.parse(flags.data) : {};
        const job = await queue.add(name, data, {
          timeout_ms: flags.timeout ? parseInt(flags.timeout, 10) : undefined,
          max_attempts: flags['max-attempts'] ? parseInt(flags['max-attempts'], 10) : undefined,
          idempotency_key: flags['idempotency-key'],
        }, { allowProtectedSubmit: true });
        console.log(JSON.stringify({ id: job.id, name: job.name, status: job.status }, null, 2));
        break;
      }

      case 'work': {
        const { flags } = parseFlags(rest);
        const concurrency = flags.concurrency ? parseInt(flags.concurrency, 10) : 4;
        const queueName = flags.queue ?? 'default';
        await queue.ensureSchema();
        const worker = new MinionWorker(engine, { concurrency, queue: queueName });
        for (const [name, handler] of Object.entries(HANDLERS)) worker.register(name, handler);
        const stop = async () => {
          console.log('[minions-worker] stopping…');
          await worker.stop();
          await engine.close();
          process.exit(0);
        };
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
        console.log(`[minions-worker] starting (concurrency=${concurrency}, queue=${queueName}, handlers=${Object.keys(HANDLERS).join(',')})`);
        await worker.start(); // blocks until stop() resolves
        return;
      }

      case 'list': {
        const { flags } = parseFlags(rest);
        const status = flags.status;
        const limit = flags.limit ? parseInt(flags.limit, 10) : 50;
        const rows = await engine.executeRaw(
          status
            ? `SELECT id,name,status,attempts_made,created_at,finished_at,error_text FROM minion_jobs WHERE status=$1 ORDER BY id DESC LIMIT $2`
            : `SELECT id,name,status,attempts_made,created_at,finished_at,error_text FROM minion_jobs ORDER BY id DESC LIMIT $1`,
          status ? [status, limit] : [limit],
        );
        console.table(rows);
        break;
      }

      case 'show': {
        const id = parseInt(rest[0] || '', 10);
        if (!id) usage();
        const job = await queue.getJob(id);
        console.log(JSON.stringify(job, null, 2));
        break;
      }

      case 'cancel': {
        const id = parseInt(rest[0] || '', 10);
        if (!id) usage();
        const job = await queue.cancelJob(id);
        console.log(JSON.stringify(job, null, 2));
        break;
      }

      case 'smoke': {
        await queue.ensureSchema();
        const job = await queue.add('shell', { cmd: 'echo smoke-ok', cwd: process.cwd() }, { timeout_ms: 5000 }, { allowProtectedSubmit: true });
        console.log(`submitted job ${job.id} (smoke). spawning one-shot worker…`);
        const worker = new MinionWorker(engine, { concurrency: 1, pollInterval: 200 });
        worker.register('shell', shellHandler);
        // start() blocks — run in background, poll DB for completion
        const workerPromise = worker.start();
        const start = Date.now();
        let result: { status: string; result: unknown; error_text: string | null } | null = null;
        while (Date.now() - start < 10_000) {
          const j = await queue.getJob(job.id);
          if (j && (j.status === 'completed' || j.status === 'failed' || j.status === 'dead')) {
            result = { status: j.status, result: j.result, error_text: j.error_text };
            break;
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        await worker.stop();
        await workerPromise.catch(() => {});
        if (!result) { console.error('smoke: timed out after 10s'); process.exit(1); }
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.status === 'completed' ? 0 : 1);
      }

      default:
        usage();
    }
  } finally {
    await engine.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
