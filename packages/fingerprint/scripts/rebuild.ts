// Bun resolves the parent monorepo's workspaces during install. Build in an
// isolated copy so this package's own frozen lockfile controls every dependency.
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const staging = await mkdtemp(join(tmpdir(), 'fingerprint-rebuild-'));
try {
  await cp(root, staging, {
    recursive: true,
    filter: (path) => !['node_modules', 'dist', '.git'].includes(basename(path)),
  });
  for (const args of [
    [
      'install',
      '--frozen-lockfile',
      '--ignore-scripts',
      '--registry',
      'https://registry.npmjs.org',
    ],
    ['run', 'check'],
  ]) {
    const process = Bun.spawn([Bun.argv[0], ...args], {
      cwd: staging,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...Bun.env,
        PATH: `${resolve(Bun.argv[0], '..')}:${Bun.env.PATH || ''}`,
      },
    });
    const code = await process.exited;
    if (code !== 0) throw new Error(`bun ${args.join(' ')} exited ${code}`);
  }
  await rm(join(root, 'dist'), { recursive: true, force: true });
  await cp(join(staging, 'dist'), join(root, 'dist'), { recursive: true });
} finally {
  await rm(staging, { recursive: true, force: true });
}
