import { expect, test } from 'bun:test';
import { boundedText } from '../src/http';
test('bounded JSON reader cancels oversized streaming gateway responses', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(out) {
      out.enqueue(new Uint8Array(512));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(boundedText(new Response(stream), 1000)).rejects.toThrow('size limit');
  expect(cancelled).toBe(true);
});
