import { connect } from "node:net";

/**
 * The client side of these tests, written against a socket rather than `fetch`
 * for the three things `fetch` cannot do: send `Expect: 100-continue`, send a
 * body that the server never asked for, and count what went out. `undici` waits
 * for nothing and reports nothing about bytes written, so a client that has to
 * be honest about a reset has to be built here.
 */

/** Every status line in a raw response, so a `100` and the final answer differ. */
export function statusLines(raw: string): string[] {
  return [...raw.matchAll(/^HTTP\/1\.1 (\d{3})(?: .*)?$/gm)].map(
    (match) => `HTTP/1.1 ${String(match[1])}`,
  );
}

/** The status of the last answer in a raw response, exactly as it was written. */
export function finalStatus(raw: string): string {
  const lines = statusLines(raw);
  return lines[lines.length - 1] ?? "";
}

export function headOf(
  requestLine: string,
  headers: readonly string[],
  keepAlive = false,
): string {
  return [
    requestLine,
    "Host: localhost",
    ...(keepAlive ? [] : ["Connection: close"]),
    ...headers,
    "",
    "",
  ].join("\r\n");
}

export interface RawResult {
  readonly status: string;
  readonly body: string;
  readonly sent: number;
  readonly reset: boolean;
}

const GIVE_UP_MS = 10_000;

/**
 * A client that honours `Expect: 100-continue`: it sends the head, waits for the
 * answer, and only then the body. `sent` is what the socket says went out — not
 * what `write()` returned, which is a statement about buffering, not delivery.
 */
export async function expectingRequest(
  port: number,
  requestLine: string,
  headers: readonly string[],
  body: string | Buffer,
  waitForContinue = true,
): Promise<RawResult> {
  const socket = connect(port, "127.0.0.1");
  socket.setEncoding("utf8");
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  let raw = "";
  let sent = 0;
  let headAt = 0;
  let waited = false;
  let reset = false;
  const sendBody = (): void => {
    socket.write(bytes);
    sent = socket.bytesWritten - headAt;
  };
  return new Promise((settled) => {
    const settle = (): void => {
      settled({ status: finalStatus(raw), sent, body: raw, reset });
      socket.destroy();
    };
    const giveUp = setTimeout(settle, GIVE_UP_MS);
    const finish = (): void => {
      clearTimeout(giveUp);
      settle();
    };
    socket.on("data", (text: string) => {
      raw += text;
      // A 100 is the only answer that is not the end of it, so the body goes out
      // on that one and nowhere else.
      if (!waited && statusLines(raw).includes("HTTP/1.1 100")) {
        waited = true;
        sendBody();
        return;
      }
      if (raw.endsWith("\r\n\r\n")) {
        finish();
      }
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      reset = error.code === "ECONNRESET";
      finish();
    });
    socket.on("close", finish);
    socket.on("connect", () => {
      socket.write(headOf(requestLine, headers));
      headAt = socket.bytesWritten;
      if (!waitForContinue) {
        sendBody();
      }
    });
  });
}

/**
 * A client that sends everything it was asked to send and then holds the socket
 * open: the whole body, whether or not the server wanted it, and no close from
 * this side. It settles when the server drops the connection — which is the thing
 * under test — or when it has given up.
 *
 * With `keepAlive` it asks for nothing to be closed on its behalf either, so the
 * only thing that can end the connection is the server's own decision.
 */
export async function sendAndHold(
  port: number,
  requestLine: string,
  headers: readonly string[],
  body: string | Buffer,
  keepAlive = false,
): Promise<RawResult> {
  const socket = connect(port, "127.0.0.1");
  socket.setEncoding("utf8");
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  const chunk = 65_536;
  let raw = "";
  let headAt = 0;
  let reset = false;
  return new Promise((settled) => {
    const settle = (): void => {
      settled({
        status: finalStatus(raw),
        body: raw,
        sent: socket.bytesWritten - headAt,
        reset,
      });
      socket.destroy();
    };
    const giveUp = setTimeout(settle, GIVE_UP_MS);
    socket.on("data", (text: string) => {
      raw += text;
      // Keep going whatever the server said: a client mid-body does not know yet
      // that it was refused, and the point is what the server does with it.
      while (
        socket.writable &&
        socket.bytesWritten - headAt < bytes.byteLength
      ) {
        const at = socket.bytesWritten - headAt;
        if (
          !socket.write(
            bytes.subarray(at, Math.min(at + chunk, bytes.byteLength)),
          )
        ) {
          return;
        }
      }
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      reset = error.code === "ECONNRESET";
      clearTimeout(giveUp);
      settle();
    });
    socket.on("close", () => {
      clearTimeout(giveUp);
      settle();
    });
    socket.on("connect", () => {
      socket.write(headOf(requestLine, headers, keepAlive));
      headAt = socket.bytesWritten;
      while (
        socket.writable &&
        socket.bytesWritten - headAt < bytes.byteLength
      ) {
        const at = socket.bytesWritten - headAt;
        if (
          !socket.write(
            bytes.subarray(at, Math.min(at + chunk, bytes.byteLength)),
          )
        ) {
          return;
        }
      }
    });
  });
}

/** Sends a request and one body, then reads whatever comes back. */
export async function rawRequest(
  port: number,
  requestLine: string,
  headers: readonly string[],
  body: string | Buffer = "",
): Promise<string> {
  const socket = connect(port, "127.0.0.1");
  socket.setEncoding("utf8");
  const chunks: string[] = [];
  socket.on("data", (chunk: string) => chunks.push(chunk));
  await new Promise<void>((ready) => {
    socket.on("connect", () => ready());
  });
  const head = Buffer.from(headOf(requestLine, headers), "utf8");
  socket.write(
    Buffer.concat([
      head,
      Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8"),
    ]),
  );
  await new Promise<void>((ended) => {
    socket.on("close", () => ended());
  });
  socket.destroy();
  return chunks.join("");
}
