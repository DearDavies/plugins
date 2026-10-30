import { expect, test } from 'bun:test';
import { generateChallenges, requestSample } from '../vendor/lmfpd-sdk/index.js';
import { normalizeChatStream } from '../src/sse';

test('real SDK accepts a clean chat stop without sentinel, but still rejects incomplete endings', async () => {
  const challenge = generateChallenges(1)[0];
  const text = Array.from({ length: challenge.expected_count }, (_, i) => (i % 355) + 1).join(', ');
  let ending = 'stop',
    repaired = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      const data = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: ending || null }] })}\n\n`;
      const source = new ReadableStream<Uint8Array>({
        start(out) {
          out.enqueue(new TextEncoder().encode(data));
          out.close();
        },
      });
      return new Response(
        normalizeChatStream(source, () => repaired++),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  try {
    const sample = () =>
      requestSample(
        {
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
          apiKey: 'test',
          model: 'test',
          api: 'chat_completions',
          strict: true,
          stream: true,
        },
        challenge,
      );
    const complete = await sample();
    expect(complete.state).toBe('complete');
    expect(complete.count).toBe(challenge.expected_count);
    expect(repaired).toBe(1);
    for (ending of ['length', '']) {
      expect((await sample()).state).toBe('failed');
      expect(repaired).toBe(1);
    }
  } finally {
    server.stop(true);
  }
});

test('chat sentinel is preserved and a broken stream after stop is never repaired', async () => {
  let repaired = false;
  const data =
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  const source = new Response(data).body!;
  expect(await new Response(normalizeChatStream(source, () => (repaired = true))).text()).toBe(
    data,
  );
  expect(repaired).toBe(false);
  const broken = new ReadableStream<Uint8Array>({
    start(out) {
      out.enqueue(new TextEncoder().encode(data.split('data: [DONE]')[0]));
    },
    pull(out) {
      out.error(new Error('upstream disconnected'));
    },
  });
  await expect(
    new Response(normalizeChatStream(broken, () => (repaired = true))).text(),
  ).rejects.toThrow('upstream disconnected');
  expect(repaired).toBe(false);
});
