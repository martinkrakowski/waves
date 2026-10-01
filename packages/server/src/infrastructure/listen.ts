const BIND_CODES: ReadonlySet<string> = new Set([
  "EADDRINUSE",
  "EACCES",
  "EADDRNOTAVAIL",
]);

/**
 * The part of `node:http`'s server this module needs, so the bind can be
 * exercised without opening a socket.
 */
export interface ListenableServer {
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  listen(port: number, host: string, listener: () => void): unknown;
}

export type ListenResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Listens with an error listener attached first, so a refused bind is reported
 * as a configuration problem instead of an unhandled `error` event. Only the
 * three failures an operator can act on are turned into a message; anything else
 * is a bug and travels on as the error it is.
 */
export function listen(
  server: ListenableServer,
  host: string,
  port: number,
): Promise<ListenResult> {
  return new Promise<ListenResult>((settled, refused) => {
    const onError = (error: unknown): void => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === undefined || !BIND_CODES.has(code)) {
        refused(error);
        return;
      }
      settled({
        ok: false,
        message: `cannot listen on ${host}:${port}: ${code}`,
      });
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      settled({ ok: true });
    });
  });
}
