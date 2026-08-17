import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

async function startServer() {
  const port = 19000 + Math.floor(Math.random() * 1000);
  const storeDir = await mkdtemp(path.join(os.tmpdir(), 'lyra-server-'));
  const child = spawn(process.execPath, ['app/server.js'], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, LYRA_APP_PORT: String(port), LYRA_APP_TOKEN: 'test-token', LYRA_APP_DATA_DIR: storeDir }, stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { await fetch(`http://127.0.0.1:${port}/health`); return { child, port }; } catch { await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  child.kill('SIGTERM');
  throw new Error('Lyra server did not start');
}

test('server exposes health and protects API behind a session', async () => {
  const { child, port } = await startServer();
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const shell = await fetch(`http://127.0.0.1:${port}/app/`);
    assert.equal(shell.status, 200);
    assert.match(await shell.text(), /assets\/main\.js/);
    const denied = await fetch(`http://127.0.0.1:${port}/v1/today`);
    assert.equal(denied.status, 401);
    const signIn = await fetch(`http://127.0.0.1:${port}/v1/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'test-token' }) });
    assert.equal(signIn.status, 201);
    const cookie = signIn.headers.get('set-cookie');
    const today = await fetch(`http://127.0.0.1:${port}/v1/today`, { headers: { cookie } });
    assert.equal(today.status, 200);
    assert.ok(Array.isArray((await today.json()).warnings));
    const feed = await fetch(`http://127.0.0.1:${port}/v1/feed`, { headers: { cookie } });
    assert.equal(feed.status, 200);
    assert.ok(Array.isArray((await feed.json()).events));
    const tasks = await fetch(`http://127.0.0.1:${port}/v1/tasks`, { headers: { cookie } });
    assert.equal(tasks.status, 200);
    const metrics = await fetch(`http://127.0.0.1:${port}/v1/metrics`, { headers: { cookie } });
    assert.equal(metrics.status, 200);
    assert.equal(typeof (await metrics.json()).messages, 'number');
    const pushTest = await fetch(`http://127.0.0.1:${port}/v1/push/test`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(pushTest.status, 200);
    assert.equal((await pushTest.json()).queued, true);
    const logout = await fetch(`http://127.0.0.1:${port}/v1/auth/logout`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(logout.status, 200);
    const afterLogout = await fetch(`http://127.0.0.1:${port}/v1/today`, { headers: { cookie } });
    assert.equal(afterLogout.status, 401);
  } finally { child.kill('SIGTERM'); }
});
