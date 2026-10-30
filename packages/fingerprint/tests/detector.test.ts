import { describe, expect, test } from 'bun:test';
import { createJob, runJob } from '../src/detector.js';
import type { Model, RunConfig } from '../src/types.js';

const model: Model = {
  id: 'm1',
  name: 'Model 1',
  provider: 'p',
  efforts: ['default'],
  nativeEndpoints: ['/v1/responses', '/v1/chat/completions'],
};
const config: RunConfig = {
  targets: [{ model: 'm1' }, { model: 'm1', account: 'a' }],
  api: 'auto',
  effort: 'default',
  serviceTier: 'default',
  strict: false,
  targetParallel: 2,
  sampleParallel: 2,
  deadlineSeconds: 30,
};
const sample = (expected_count: number) => ({
  state: 'complete' as const,
  text: '1, 2, 3',
  raw_text: '1, 2, 3',
  count: 3,
  expected_count,
  first_byte_ms: 1,
  response_model: 'm1',
  response_id: 'r',
  error: null,
});

describe('detector jobs', () => {
  test('generates one shared challenge batch and resolves auto API', () => {
    const job = createJob(config, [model], '2026-01-01');
    expect(job.challenges).toHaveLength(3);
    expect(job.results[0].api).toBe('responses');
    expect(job.results[0].samples.map((s) => s.expected_count)).toEqual(
      job.challenges.map((c) => c.expected_count),
    );
    expect(job.results[1].samples.map((s) => s.expected_count)).toEqual(
      job.results[0].samples.map((s) => s.expected_count),
    );
  });

  test('uses per-sample endpoint and scores injected samples', async () => {
    const job = createJob({ ...config, targets: [{ model: 'm1' }] }, [model], 'build');
    const indexes: number[] = [];
    let analyzed = 0;
    let seenStrictCount = 0;
    await runJob(job, {
      detector: {
        analyze: (outputs: unknown[]) => {
          analyzed = outputs.length;
          return { decision: 'partial' } as never;
        },
      } as never,
      signal: new AbortController().signal,
      sampleEndpoint: (_result, index) => {
        indexes.push(index);
        return { baseUrl: 'https://proxy.test', apiKey: 'secret' };
      },
      sample: async (requestConfig, challenge) => {
        seenStrictCount = requestConfig.count ?? 0;
        return sample(challenge.expected_count);
      },
      onUpdate: () => {},
    });
    expect(indexes.sort()).toEqual([0, 1, 2]);
    expect(analyzed).toBe(3);
    expect(seenStrictCount).toBe(3);
    expect(job.state).toBe('completed');
    expect(job.results[0].analysis?.decision).toBe('partial');
  });

  test('keeps partial evidence when one sample fails', async () => {
    const job = createJob({ ...config, targets: [{ model: 'm1' }] }, [model], 'build');
    let analyzed = 0;
    await runJob(job, {
      detector: {
        analyze: (outputs: unknown[]) => {
          analyzed = outputs.length;
          return {} as never;
        },
      } as never,
      signal: new AbortController().signal,
      sampleEndpoint: () => ({ baseUrl: 'https://proxy.test', apiKey: 'secret' }),
      sample: async (_config, challenge) =>
        challenge.expected_count === job.challenges[0].expected_count
          ? { ...sample(challenge.expected_count), state: 'failed', error: 'upstream' }
          : sample(challenge.expected_count),
      onUpdate: () => {},
    });
    expect(analyzed).toBe(2);
    expect(job.results[0].state).toBe('failed');
  });

  test('honors proxy mismatch and does not overwrite provenance with vendor alias', async () => {
    const job = createJob({ ...config, targets: [{ model: 'm1' }] }, [model], 'build');
    job.results[0].provenance[0] = {
      session: 'proxy-session',
      requestedModel: 'm1',
      model: 'm1',
      provider: 'p',
    };
    job.results[0].provenance[1] = {
      session: 'proxy-session',
      requestedModel: 'm1',
      model: 'other',
      mismatch: true,
    };
    let analyzed = false;
    await runJob(job, {
      detector: {
        analyze: () => {
          analyzed = true;
          return {} as never;
        },
      } as never,
      signal: new AbortController().signal,
      sampleEndpoint: () => ({ baseUrl: 'https://proxy.test', apiKey: 'secret' }),
      sample: async (_config, challenge) => ({
        ...sample(challenge.expected_count),
        response_model: 'vendor-alias',
      }),
      onUpdate: () => {},
    });
    expect(analyzed).toBe(false);
    expect(job.results[0].provenance[0].session).toBe('proxy-session');
    expect(job.results[0].provenance[0].model).toBe('m1');
    expect(job.results[0].state).toBe('failed');
    expect(job.state).toBe('failed');
  });

  test('does not score cancelled queued samples', async () => {
    const job = createJob({ ...config, targets: [{ model: 'm1' }] }, [model], 'build');
    const controller = new AbortController();
    controller.abort();
    let analyzed = false;
    await runJob(job, {
      detector: {
        analyze: () => {
          analyzed = true;
          return {} as never;
        },
      } as never,
      signal: controller.signal,
      sampleEndpoint: () => ({ baseUrl: 'https://proxy.test', apiKey: 'secret' }),
      sample: async (_config, challenge) => sample(challenge.expected_count),
      onUpdate: () => {},
    });
    expect(analyzed).toBe(false);
    expect(job.state).toBe('cancelled');
    expect(job.results[0].samples.every((item) => item.state === 'cancelled')).toBe(true);
  });
});
