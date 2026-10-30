import { mkdir, readdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job } from './types';
export class Store {
  readonly jobs = new Map<string, Job>();
  private writing = Promise.resolve();
  constructor(readonly dir: string) {}
  async load() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.dir)) {
      if (!/^[\w-]+\.json$/.test(name)) continue;
      try {
        const job = JSON.parse(await readFile(join(this.dir, name), 'utf8')) as Job;
        if (!job.id || !Array.isArray(job.results) || name !== `${job.id}.json`) continue;
        if (job.state === 'running' || job.state === 'queued') {
          job.state = 'interrupted';
          job.error = 'The plugin service restarted before this job finished.';
          job.finishedAt = new Date().toISOString();
          for (const r of job.results)
            if (r.state === 'running' || r.state === 'queued') {
              r.state = 'cancelled';
              r.analysis = null;
            }
          await this.save(job);
        }
        this.jobs.set(job.id, job);
      } catch {
        /* Ignore damaged files; never replace them with invented results. */
      }
    }
  }
  list() {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  save(job: Job) {
    const contents = JSON.stringify(job);
    const path = join(this.dir, `${job.id}.json`);
    const next = this.writing.then(async () => {
      const temp = `${path}.tmp`;
      await writeFile(temp, contents, { mode: 0o600 });
      await rename(temp, path);
    });
    this.writing = next.catch(() => {});
    return next;
  }
  async remove(id: string) {
    await this.writing;
    await unlink(join(this.dir, `${id}.json`));
    this.jobs.delete(id);
  }
  async flush() {
    await this.writing;
  }
}
