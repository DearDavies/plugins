import { options, type Options } from './config';
import { boundedText } from './http';
import { startServer } from './server';
import { serviceIdentity } from './service-identity';

/** Hosts with identical settings share one listener. An attached host takes over
 * when its owner exits; no detached daemon survives the Magpie hosts. */
export async function startManagedService(input: Options = {}, pollMs = 1000) {
  const opt = options(input);
  const identity = serviceIdentity(opt);
  let owned: Awaited<ReturnType<typeof startServer>> | undefined;
  let closed = false;
  let checking: Promise<void> | undefined;
  let lastError = '';
  const probe = async () => {
    if (!opt.port) return false;
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${opt.port}/_fingerprint/health`, {
        signal: AbortSignal.timeout(1000),
        redirect: 'error',
      });
    } catch {
      return false;
    }
    try {
      const peer = JSON.parse(await boundedText(response, 4096));
      if (
        response.ok &&
        peer.app === identity.app &&
        peer.protocol === identity.protocol &&
        peer.configuration === identity.configuration
      )
        return true;
    } catch {
      /* An occupied port is never assumed to be our service. */
    }
    throw new Error(
      `Port ${opt.port} belongs to an incompatible Fingerprint service or another application. Use another port, or turn Fingerprint off and on after upgrading.`,
    );
  };
  const acquire = async () => {
    if (closed || owned || (await probe())) return;
    try {
      owned = await startServer(opt);
    } catch (error) {
      // Another host may have won between discovery and bind.
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && (await probe())) return;
      throw error;
    }
    if (closed) {
      await owned.close();
      owned = undefined;
    }
  };
  const reconcile = () =>
    (checking ??= acquire().finally(() => {
      checking = undefined;
    }));
  await reconcile();
  const timer = setInterval(() => {
    void reconcile()
      .then(() => {
        lastError = '';
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastError) console.warn(`Fingerprint service recovery: ${message}`);
        lastError = message;
      });
  }, pollMs);
  timer.unref();
  return {
    get port() {
      return owned?.port ?? opt.port;
    },
    get role() {
      return owned ? ('owner' as const) : ('attached' as const);
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await checking;
      await owned?.close();
      owned = undefined;
    },
  };
}
