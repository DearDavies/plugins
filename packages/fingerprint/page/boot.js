(() => {
  const messages = {
    en: {
      title: 'Fingerprint',
      connecting: 'Connecting to Fingerprint…',
      remote:
        'Upgrade Magpie for remote plugin services, or forward the service port to this computer over SSH.',
      invalidPort: 'Invalid Fingerprint service port.',
      failed: 'Could not connect',
    },
    'zh-Hans': {
      title: '模型指纹',
      connecting: '正在连接模型指纹服务…',
      remote: '请升级 Magpie 以支持远程插件服务，或将服务器的服务端口通过 SSH 转发到本机。',
      invalidPort: '模型指纹服务端口无效。',
      failed: '连接失败',
    },
    'zh-Hant': {
      title: '模型指紋',
      connecting: '正在連線至模型指紋服務…',
      remote: '請升級 Magpie 以支援遠端外掛服務，或透過 SSH 將伺服器的服務連接埠轉送至本機。',
      invalidPort: '模型指紋服務連接埠無效。',
      failed: '連線失敗',
    },
    ja: {
      title: 'モデル指紋',
      connecting: 'モデル指紋サービスに接続中…',
      remote:
        'リモートプラグインサービスを利用するには、Magpie を更新するか、SSH でサービスポートをこのコンピューターに転送してください。',
      invalidPort: 'モデル指紋サービスのポートが無効です。',
      failed: '接続できませんでした',
    },
    de: {
      title: 'Modell-Fingerabdruck',
      connecting: 'Verbindung zum Fingerabdruck-Dienst wird hergestellt…',
      remote:
        'Aktualisieren Sie Magpie für entfernte Plugin-Dienste oder leiten Sie den Dienstport per SSH an diesen Computer weiter.',
      invalidPort: 'Ungültiger Port für den Fingerabdruck-Dienst.',
      failed: 'Verbindung fehlgeschlagen',
    },
  };
  let text = messages.en;
  const status = document.getElementById('status');
  function followLanguage(theme) {
    const language = String(theme?.lang || 'en')
      .toLowerCase()
      .replaceAll('_', '-');
    const parts = language.split('-');
    const key =
      parts[0] === 'zh'
        ? parts.includes('hant') ||
          (!parts.includes('hans') && parts.some((part) => ['tw', 'hk', 'mo'].includes(part)))
          ? 'zh-Hant'
          : 'zh-Hans'
        : parts[0];
    text = messages[key] || messages.en;
    document.documentElement.lang = messages[key] ? key : 'en';
    document.title = text.title;
    document.getElementById('title').textContent = text.title;
    status.textContent = text.connecting;
  }
  return (async () => {
    const theme = await window.magpie?.ready;
    followLanguage(theme);
    window.magpie?.onTheme?.(followLanguage);
    const config = (await window.magpie?.options?.get?.()) || {};
    const port = Number(config.port ?? 3488);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(text.invalidPort);
    let service = window.magpie?.service;
    if (!service) {
      const local =
        !location.hostname || ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
      if (!local) {
        status.textContent = text.remote;
        return;
      }
      service = `http://127.0.0.1:${port}/`;
    }
    const url = new URL(service, location.href);
    // Opaque Magpie web frames need the concrete proxy origin in connect-src.
    url.searchParams.set('uiOrigin', url.origin);
    if (theme) {
      url.searchParams.set('theme', theme.dark ? 'dark' : 'light');
      if (theme.lang) url.searchParams.set('lang', theme.lang);
    }
    const context = window.magpie?.context?.provider;
    if (context?.id) url.searchParams.set('provider', context.id);
    window.magpie?.onAction((action) => {
      if (action?.provider?.id) {
        url.searchParams.set('provider', action.provider.id);
        location.replace(url.href);
      }
    });
    location.replace(url.href);
  })().catch((error) => {
    status.textContent = `${text.failed}: ${String(error?.message || error)}`;
  });
})();
