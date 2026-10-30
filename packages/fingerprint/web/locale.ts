export type Locale = 'en' | 'zh-Hans' | 'zh-Hant';

/** English is the fallback; Chinese scripts take precedence over regions. */
export function localeFor(value?: string): Locale {
  const parts = (value || '').toLowerCase().replaceAll('_', '-').split('-');
  if (parts[0] !== 'zh') return 'en';
  if (parts.includes('hans')) return 'zh-Hans';
  if (parts.includes('hant') || parts.some((part) => ['tw', 'hk', 'mo'].includes(part)))
    return 'zh-Hant';
  return 'zh-Hans';
}
