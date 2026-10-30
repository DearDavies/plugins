import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../page/boot.js', import.meta.url), 'utf8');
async function boot(lang?: string, remote = false, port = 3488) {
  const elements = {
    status: { textContent: 'Connecting to Fingerprint…' },
    title: { textContent: 'Fingerprint' },
  };
  const document = {
    title: 'Fingerprint',
    documentElement: { lang: 'en' },
    getElementById: (id: keyof typeof elements) => elements[id],
  };
  let destination: URL | undefined;
  const service = remote ? '' : 'http://127.0.0.1:3488/';
  await runInNewContext(source, {
    URL,
    document,
    window: {
      magpie: {
        ready: Promise.resolve({ dark: true, ...(lang ? { lang } : {}) }),
        service,
        context: { provider: { id: 'vendor' } },
        options: { get: async () => ({ port }) },
        onAction() {},
        onTheme() {},
      },
    },
    location: {
      hostname: remote ? 'magpie.example' : '127.0.0.1',
      href: 'http://127.0.0.1/boot/index.html',
      replace: (url: string) => {
        destination = new URL(url);
      },
    },
  });
  return { document, elements, destination };
}

test('boot defaults to English and follows host languages before navigation', async () => {
  for (const [lang, htmlLang, status] of [
    [undefined, 'en', 'Connecting'],
    ['fr', 'en', 'Connecting'],
    ['zh-CN', 'zh-Hans', '正在连接'],
    ['zh-TW', 'zh-Hant', '正在連線'],
    ['zh-Hant-HK', 'zh-Hant', '正在連線'],
    ['zh_HK', 'zh-Hant', '正在連線'],
    ['ja', 'ja', '接続中'],
    ['de-DE', 'de', 'Verbindung'],
  ]) {
    const result = await boot(lang);
    expect(result.document.documentElement.lang).toBe(htmlLang!);
    expect(result.elements.status.textContent).toContain(status!);
    expect(result.destination?.searchParams.get('provider')).toBe('vendor');
    expect(result.destination?.searchParams.get('uiOrigin')).toBe('http://127.0.0.1:3488');
    expect(result.destination?.searchParams.get('lang')).toBe(lang || null);
  }
});

test('boot localizes remote-service guidance and invalid-port errors', async () => {
  const remote = await boot('zh-TW', true);
  expect(remote.destination).toBeUndefined();
  expect(remote.elements.status.textContent).toContain('遠端外掛');
  const invalid = await boot('de', false, -1);
  expect(invalid.destination).toBeUndefined();
  expect(invalid.elements.status.textContent).toContain('Ungültiger Port');
});
