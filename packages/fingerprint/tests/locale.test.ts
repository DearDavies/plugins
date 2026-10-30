import { expect, test } from 'bun:test';
import { localeFor } from '../web/locale';

test('unsupported host languages fall back to English and Chinese respects script and region', () => {
  for (const value of [undefined, '', 'en', 'en-US', 'ja', 'de', 'fr', 'zho'])
    expect(localeFor(value)).toBe('en');
  for (const value of ['zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-TW', 'zh_Hans_CN'])
    expect(localeFor(value)).toBe('zh-Hans');
  for (const value of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-CN', 'zh_Hant_HK'])
    expect(localeFor(value)).toBe('zh-Hant');
});
