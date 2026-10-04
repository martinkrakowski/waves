import { isWaveId } from "@hexagen-monaco/waves-contract";

import { isRecord, own } from "./object.js";

/**
 * How many waves one collector may print. A snapshot is a document of a few
 * lanes, and a collector printing more than this is printing something other
 * than a status of the project — the cap is here so that such a thing fails as a
 * failed collection rather than as a run that spends the whole tick.
 */
export const MAX_COLLECTOR_WAVES = 32;

/** One wave as a collector prints it. */
export interface CollectorWave {
  readonly wave: string;
  readonly lanes: readonly unknown[];
}

export interface CollectorOutput {
  readonly waves: readonly CollectorWave[];
  /** What `waves status --file` accepts, or `undefined` when there is none. */
  readonly status?: Record<string, unknown>;
}

export type CollectorResult =
  | { readonly ok: true; readonly output: CollectorOutput }
  | { readonly ok: false; readonly error: string };

/** The only keys a collector's object and one of its waves may have. */
const OUTPUT_KEYS = ["waves", "status"];
const WAVE_KEYS = ["wave", "lanes"];

/**
 * What a collector printed, or the one reason it is not something this client can
 * send.
 *
 * Only the shape is judged here. Each wave and the status are the contract's own
 * business and are validated exactly as `push` and `status` validate them, one
 * document at a time, so a bad wave costs that wave and not the collection.
 *
 * One refusal rather than a list, because there is no editor waiting: a collector
 * prints what it prints, and the run has a line budget of one per project. The
 * message says what was wrong and never quotes what was printed, since a
 * collector's output is text this client did not write.
 */
export function readCollectorOutput(text: string): CollectorResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "the collector printed something that is not JSON",
    };
  }
  if (!isRecord(parsed)) {
    return {
      ok: false,
      error: "the collector printed something that is not a JSON object",
    };
  }
  const unknown = Object.keys(parsed).filter(
    (key) => !OUTPUT_KEYS.includes(key),
  );
  if (unknown.length > 0) {
    return {
      ok: false,
      error: "the collector printed a key this client does not know",
    };
  }
  const waves = readWaves(own(parsed, "waves"));
  if (!waves.ok) {
    return waves;
  }
  const rawStatus = own(parsed, "status");
  if (rawStatus !== undefined && !isRecord(rawStatus)) {
    return { ok: false, error: "the collector's status must be a JSON object" };
  }
  return {
    ok: true,
    output: {
      waves: waves.waves,
      ...(isRecord(rawStatus) ? { status: rawStatus } : {}),
    },
  };
}

type WavesRead =
  | { readonly ok: true; readonly waves: readonly CollectorWave[] }
  | { readonly ok: false; readonly error: string };

/**
 * The waves, or the one reason there are none to send. A wave id twice is an
 * invalid output rather than a duplicate to send twice: which of the two the
 * project meant is a question only its own code can answer.
 */
function readWaves(raw: unknown): WavesRead {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "the collector printed no waves array" };
  }
  if (raw.length > MAX_COLLECTOR_WAVES) {
    return {
      ok: false,
      error: `the collector printed ${raw.length} waves; at most ${MAX_COLLECTOR_WAVES} are read`,
    };
  }
  const waves: CollectorWave[] = [];
  const seen = new Set<string>();
  for (const [index, value] of raw.entries()) {
    const read = readWave(value, index, seen);
    if (!read.ok) {
      return read;
    }
    waves.push(read.wave);
  }
  return { ok: true, waves };
}

type WaveRead =
  | { readonly ok: true; readonly wave: CollectorWave }
  | { readonly ok: false; readonly error: string };

function readWave(value: unknown, index: number, seen: Set<string>): WaveRead {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: `wave ${index}: must be an object with a wave and its lanes`,
    };
  }
  const unknown = Object.keys(value).filter((key) => !WAVE_KEYS.includes(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `wave ${index}: holds a key this client does not know`,
    };
  }
  const wave = own(value, "wave");
  if (typeof wave !== "string" || !isWaveId(wave)) {
    return { ok: false, error: `wave ${index}: wave is not a wave id` };
  }
  if (seen.has(wave)) {
    return { ok: false, error: `the collector printed wave ${wave} twice` };
  }
  seen.add(wave);
  const lanes = own(value, "lanes");
  if (!Array.isArray(lanes)) {
    return { ok: false, error: `wave ${index}: lanes must be an array` };
  }
  return { ok: true, wave: { wave, lanes } };
}
