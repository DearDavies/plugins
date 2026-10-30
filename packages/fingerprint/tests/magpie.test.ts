import { expect, test } from 'bun:test';
import { normalizeTheme } from '../web/magpie';

test('normalizes a host theme while retaining only string tokens', () => {
  expect(
    normalizeTheme({
      dark: true,
      lang: 'zh-CN',
      tokens: { bg: '#101114', fg: '#fff', radius: 6, nested: { value: 1 } },
    }),
  ).toEqual({ dark: true, lang: 'zh-CN', tokens: { bg: '#101114', fg: '#fff' } });
});

test('rejects malformed theme envelopes and supplies a language fallback', () => {
  expect(normalizeTheme(null)).toBeNull();
  expect(normalizeTheme({ dark: 'yes' })).toBeNull();
  expect(normalizeTheme({ dark: false, tokens: null })).toEqual({
    dark: false,
    lang: 'en',
    tokens: {},
  });
});
