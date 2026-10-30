/** Preserve upstream bytes; supply the SDK's sentinel only after an explicit
 * successful finish and a clean EOF. Some OpenAI-compatible gateways omit it. */
export function normalizeChatStream(
  body: ReadableStream<Uint8Array>,
  onRepair: () => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '',
    finish = '',
    done = false,
    invalid = false;
  const frame = (value: string) => {
    const data = value
      .split(/\r\n|\r|\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') {
      done = true;
      return;
    }
    try {
      const event = JSON.parse(data);
      if (event.error || event.type === 'error') invalid = true;
      const choice =
        event.choices?.find((c: { index?: number }) => c.index === 0) ?? event.choices?.[0];
      if (choice?.delta?.refusal) invalid = true;
      if (choice?.finish_reason) finish = choice.finish_reason;
    } catch {
      invalid = true;
    }
  };
  const consume = () => {
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
      frame(buffer.slice(0, boundary.index));
      buffer = buffer.slice(boundary.index + boundary[0].length);
    }
    if (buffer.length > 100000) throw new Error('SSE frame exceeded the response limit.');
  };
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, out) {
        buffer += decoder.decode(chunk, { stream: true });
        consume();
        out.enqueue(chunk);
      },
      flush(out) {
        buffer += decoder.decode();
        consume();
        if (buffer.trim()) frame(buffer);
        if (!done && !invalid && finish === 'stop') {
          onRepair();
          out.enqueue(new TextEncoder().encode('\n\ndata: [DONE]\n\n'));
        }
      },
    }),
  );
}
