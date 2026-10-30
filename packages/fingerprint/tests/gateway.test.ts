import { expect, test } from 'bun:test';
import { Gateway } from '../src/gateway';

test('catalog reads cached local and remote subscription accounts without leaking quota data', async () => {
  const paths: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      paths.push(url.pathname + url.search);
      return Response.json(
        url.pathname === '/v1/models'
          ? { data: [{ id: 'vendor/model' }] }
          : {
              data: [
                {
                  provider: 'vendor',
                  user: 'local-account',
                  name: 'Local',
                  balance: '$42',
                  secret: 'excluded',
                },
                {
                  provider: 'vendor',
                  user: 'remote-account',
                  name: 'Remote',
                  kind: 'subscription',
                },
                { provider: 'vendor', user: 'key-card', name: 'Key', kind: 'balance' },
                { provider: 'vendor', kind: 'subscription' },
              ],
            },
      );
    },
  });
  try {
    const { accounts } = await new Gateway(`http://127.0.0.1:${server.port}`).catalog();
    expect(paths).toContain('/v1/magpie/quotas?kept=1');
    expect(accounts).toEqual([
      { provider: 'vendor', id: 'local-account', name: 'Local' },
      { provider: 'vendor', id: 'remote-account', name: 'Remote' },
    ]);
  } finally {
    server.stop(true);
  }
});
