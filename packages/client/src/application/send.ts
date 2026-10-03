import type { InputSource } from "../domain/args.js";
import { reasonPhrase, serverFailure } from "../domain/reply.js";
import { decideRetry } from "../domain/retry.js";
import { Failure, UsageError } from "./errors.js";
import type {
  Files,
  HttpReply,
  HttpRequest,
  Transport,
  UseCaseDeps,
} from "./ports.js";

/** The two ports reading an input needs, and nothing else. */
type InputDeps = Pick<UseCaseDeps, "files" | "input">;

/** The two ports waiting between two attempts needs, and nothing else. */
type WaitDeps = Pick<UseCaseDeps, "clock" | "sleeper">;

/**
 * The input a project gave, read from the place it named and parsed as JSON.
 *
 * Both refusals are phrased the way the reader that raises them phrases them —
 * a file that is not there, and text that is not JSON — so that a run refused
 * before the contract is asked reads the same whichever command it was.
 */
export async function readJsonInput(
  source: InputSource,
  deps: InputDeps,
): Promise<unknown> {
  const raw =
    source.kind === "stdin"
      ? await deps.input.read()
      : await readFile(source.path, deps.files);
  try {
    return JSON.parse(raw.trim());
  } catch {
    throw new UsageError("the input is not valid JSON");
  }
}

async function readFile(path: string, files: Files): Promise<string> {
  const text = await files.readText(path);
  if (text === undefined) {
    throw new UsageError(`cannot read ${path}`);
  }
  return text;
}

/**
 * Sends a request that may be repeated, and answers the one reply that means it
 * was taken. This is for a write that replaces what the server already holds — a
 * snapshot, a status — so a second attempt can only store the same thing again.
 * A `delete` keeps its own loop, and a registration keeps its own, which never
 * repeats a 5xx: a registration may already have minted a token.
 *
 * Two budgets, counted apart: a server that is broken is not the same as a
 * server that is asking for patience, and neither of them should spend the
 * other's retries. A 429 is waited for as long as the server asked, up to the
 * cap the retry policy sets, because one write a second per project is a real
 * rate and a project spends it on pushes and on its status alike.
 *
 * Every other ending is a `Failure` named after the command, so the entrypoint
 * prints `waves push: push failed: …` and `waves status: status failed: …`
 * without either use case wording a failure of its own.
 */
export async function sendIdempotent(
  label: "push" | "status",
  request: HttpRequest,
  transport: Transport,
  deps: WaitDeps,
): Promise<HttpReply> {
  let retries = 0;
  let throttles = 0;
  for (;;) {
    const outcome = await transport.send(request);
    if (outcome.kind === "network") {
      const decision = decideRetry({ kind: "network" }, retries);
      if (decision.kind !== "wait") {
        throw new Failure(`${label} failed: ${outcome.message}`);
      }
      retries += 1;
      await deps.sleeper.sleep(decision.ms);
      continue;
    }
    const { status, headers, body } = outcome.reply;
    if (status === 200) {
      return outcome.reply;
    }
    const throttled = status === 429;
    const decision = decideRetry(
      throttled
        ? {
            kind: "throttled",
            retryAfter: headers["retry-after"],
            now: deps.clock.now(),
          }
        : { kind: status >= 500 ? "server" : "refused" },
      throttled ? throttles : retries,
    );
    if (decision.kind === "tooLong") {
      throw new Failure(
        `${label} failed: 429 Too Many Requests; the server asked to wait ${decision.seconds}s`,
      );
    }
    if (decision.kind === "wait") {
      if (throttled) {
        throttles += 1;
      } else {
        retries += 1;
      }
      await deps.sleeper.sleep(decision.ms);
      continue;
    }
    if (throttled) {
      throw new Failure(`${label} failed: 429 Too Many Requests`);
    }
    throw new Failure(
      `${label} failed: ${status} ${reasonPhrase(status)}${serverFailure(body)}`,
    );
  }
}
