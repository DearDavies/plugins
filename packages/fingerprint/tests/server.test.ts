import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server';
import { Store } from '../src/store';
import { demoHistory } from '../src/demo';
let dir: string, base: string, token: string, service: Awaited<ReturnType<typeof startServer>>;
const api = (path: string, init: RequestInit = {}) =>
  fetch(`${base}/api/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'magpie-fingerprint-test-'));
  await mkdir(join(dir, 'ui'));
  await writeFile(join(dir, 'ui/index.html'), '<!doctype html><head></head><body>Test</body>');
  service = await startServer({ port: 0, dataDir: dir, uiDir: join(dir, 'ui'), demo: true });
  base = `http://127.0.0.1:${service.port}`;
  const html = await (await fetch(base)).text();
  token = JSON.parse(html.match(/window\.__FINGERPRINT__=(.*?)<\/script>/)![1]).token;
});
afterAll(async () => {
  await service?.close();
  await rm(dir, { recursive: true, force: true });
});
test('requires bearer token and rejects cross-site origins and rebinding hosts', async () => {
  expect((await fetch(`${base}/api/bootstrap`)).status).toBe(401);
  expect((await fetch(base, { headers: { origin: 'https://attacker.example' } })).status).toBe(403);
  expect((await fetch(base, { headers: { host: 'attacker.example' } })).status).toBe(403);
  expect((await api('bootstrap', { headers: { origin: 'null' } })).status).toBe(200);
  expect(
    (
      await fetch(`${base}/api/jobs`, { method: 'OPTIONS', headers: { origin: 'null' } })
    ).headers.get('access-control-allow-headers'),
  ).toContain('Authorization');
});
test('allows the native WebKit sandbox to connect only to the validated listener', async () => {
  for (const host of [`127.0.0.1:${service.port}`, `localhost:${service.port}`]) {
    const page = await fetch(base, { headers: { host } });
    const policy = page.headers.get('content-security-policy')!;
    expect(policy.split(';').map((part) => part.trim())).toContain(
      `connect-src 'self' http://${host}`,
    );
    expect(policy).not.toContain('allow-same-origin');
  }
  const preflight = await fetch(`${base}/api/bootstrap`, {
    method: 'OPTIONS',
    headers: {
      origin: 'null',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-origin')).toBe('null');
  expect((await api('bootstrap', { headers: { origin: 'null' } })).status).toBe(200);
  expect(
    (await fetch(base, { headers: { host: 'attacker.example' } })).headers.has(
      'content-security-policy',
    ),
  ).toBe(false);
});
test('demo is explicitly identified; catalog and history never pretend to be measurements', async () => {
  const boot = await (await api('bootstrap')).json();
  expect(boot.demo).toBe(true);
  expect(boot.models.length).toBeGreaterThan(0);
  expect(boot.jobs.every((j: any) => j.demo === true)).toBe(true);
});
test('names the Magpie web proxy origin in sandbox CSP without accepting policy injection', async () => {
  const proxy = 'https://magpie.example:9443';
  const page = await fetch(`${base}/?uiOrigin=${encodeURIComponent(proxy)}`);
  expect(page.headers.get('content-security-policy')).toContain(
    `connect-src 'self' http://127.0.0.1:${service.port} ${proxy}`,
  );
  for (const invalid of [
    'not-an-origin',
    'http://*',
    'https://*.example.com',
    'https://example.com; script-src *',
    'https://example.com/path',
    'https://u:p@example.com',
    'data:text/html,hello',
    'https://example.com/?x=1',
  ]) {
    expect((await fetch(`${base}/?uiOrigin=${encodeURIComponent(invalid)}`)).status).toBe(400);
  }
  expect((await api('bootstrap', { headers: { origin: proxy } })).status).toBe(403);
});
test('creates one batch, streams snapshots, cancels, exports and deletes it', async () => {
  const config = {
    targets: [{ model: 'openai/gpt-5.5' }],
    api: 'auto',
    effort: '',
    serviceTier: 'default',
    strict: false,
    targetParallel: 1,
    sampleParallel: 3,
    deadlineSeconds: 10,
  };
  const created = await api('jobs', { method: 'POST', body: JSON.stringify(config) });
  expect(created.status).toBe(202);
  const job = await created.json();
  expect((await api('jobs', { method: 'POST', body: JSON.stringify(config) })).status).toBe(409);
  const events = await api(`jobs/${job.id}/events`);
  expect(events.headers.get('content-type')).toContain('text/event-stream');
  const reader = events.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: snapshot');
  await reader.cancel();
  expect((await api(`jobs/${job.id}/cancel`, { method: 'POST' })).status).toBe(200);
  let finished: any;
  for (let i = 0; i < 50; i++) {
    finished = await (await api(`jobs/${job.id}`)).json();
    if (finished.state === 'cancelled') break;
    await Bun.sleep(30);
  }
  expect(finished.state).toBe('cancelled');
  expect(finished.results[0].analysis).toBeNull();
  const exported = await (await api(`jobs/${job.id}/export`)).json();
  expect(exported.schema).toBe('magpie-fingerprint/v1');
  expect(exported.demo).toBe(true);
  expect((await api(`jobs/${job.id}`, { method: 'DELETE' })).status).toBe(200);
  expect((await api(`jobs/${job.id}`)).status).toBe(404);
});
test('restart marks unfinished persisted tasks as interrupted and preserves original evidence', async () => {
  const storeDir = join(dir, 'interrupted');
  const a = new Store(storeDir);
  await a.load();
  const j = demoHistory();
  j.id = 'unfinished';
  j.state = 'running';
  j.results[0].state = 'running';
  await a.save(j);
  const b = new Store(storeDir);
  await b.load();
  const recovered = b.jobs.get(j.id)!;
  expect(recovered.state).toBe('interrupted');
  expect(recovered.results[0].analysis).toBeNull();
  expect(recovered.results[0].samples[0].raw_text).toBe(j.results[0].samples[0].raw_text);
});
test('validation fails before starting malformed jobs', async () => {
  expect((await api('jobs', { method: 'POST', body: 'null' })).status).toBe(400);
  expect(
    (
      await api('jobs', {
        method: 'POST',
        body: JSON.stringify({ targets: [{ model: 'unknown/model' }] }),
      })
    ).status,
  ).toBe(400);
});
test('bounds chunked request bodies without trusting Content-Length', async () => {
  const body = new ReadableStream({
    start(out) {
      out.enqueue(new TextEncoder().encode('x'.repeat(20000)));
      out.close();
    },
  });
  const response = await api('jobs', { method: 'POST', body });
  expect(response.status).toBe(413);
});

test('a second host cannot repair jobs belonging to the active service', async () => {
  const job = demoHistory();
  job.id = 'active-owner-job';
  job.state = 'running';
  const path = join(dir, 'demo-jobs', `${job.id}.json`);
  await writeFile(path, JSON.stringify(job));
  try {
    await expect(
      startServer({ port: service.port, dataDir: dir, uiDir: join(dir, 'ui'), demo: true }),
    ).rejects.toThrow();
    expect(JSON.parse(await readFile(path, 'utf8')).state).toBe('running');
  } finally {
    await rm(path, { force: true });
  }
});
