const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The contract refuses a `derived.log.tail` over 4096 bytes, so a client that
 * keeps the tail has to fit inside that budget itself rather than learn about it
 * from the server. The last bytes of a log are the interesting ones, so the
 * tail is cut from the FRONT.
 */
export const TAIL_BYTES = 4096;

const CONTINUATION_MASK = 0xc0;
const CONTINUATION_TAG = 0x80;

/**
 * The last `TAIL_BYTES` bytes of `text`, never splitting a code point. A cut
 * that landed inside a multi-byte character would leave a replacement character
 * in the snapshot, so leading continuation bytes are dropped and the result is
 * a little shorter than the budget.
 */
export function truncateTail(text: string): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= TAIL_BYTES) {
    return text;
  }
  let start = bytes.length - TAIL_BYTES;
  while (
    start < bytes.length &&
    (bytes[start]! & CONTINUATION_MASK) === CONTINUATION_TAG
  ) {
    start += 1;
  }
  return decoder.decode(bytes.subarray(start));
}
