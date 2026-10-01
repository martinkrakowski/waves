import type { Readable } from "node:stream";

import type { InputStream } from "../application/ports.js";

/** Everything a stream carries, as one string. Streams yield buffers or strings. */
export async function readStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function standardInput(stream: Readable = process.stdin): InputStream {
  return { read: () => readStream(stream) };
}
