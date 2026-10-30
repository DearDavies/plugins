export class BodyTooLargeError extends Error {}
/** Read a body incrementally so chunked requests cannot bypass size limits. */
export async function boundedText(input: Request | Response, limit: number) {
  if (Number(input.headers.get('content-length') || 0) > limit) {
    await input.body?.cancel();
    throw new BodyTooLargeError('Body exceeds the size limit.');
  }
  if (!input.body) return '';
  const reader = input.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new BodyTooLargeError('Body exceeds the size limit.');
      }
      chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    reader.releaseLock();
  }
}
