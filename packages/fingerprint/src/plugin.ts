import { startManagedService } from './managed-service';
import type { Options } from './config';
let instance: ReturnType<typeof startManagedService> | undefined;
export default {
  id: 'magpie-fingerprint',
  server: async (_input: unknown, opts: Options = {}) => {
    instance ??= startManagedService(opts).catch((error) => {
      instance = undefined;
      throw error;
    });
    await instance;
    return {};
  },
};
