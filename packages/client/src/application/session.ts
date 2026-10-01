import { isProjectId } from "@hexagen-monaco/waves-contract";

import {
  insecureWarning,
  readEndpoint,
  type Endpoint,
} from "../domain/endpoint.js";
import { UsageError } from "./errors.js";
import type { Environment, Files, Transport, UseCaseDeps } from "./ports.js";

export const URL_VARIABLE = "WAVES_URL";
export const PROJECT_VARIABLE = "WAVES_PROJECT";
export const CONFIG_DIR_VARIABLE = "WAVES_CONFIG_DIR";
export const CA_FILE_VARIABLE = "WAVES_CA_FILE";
export const ALLOW_INSECURE_VARIABLE = "WAVES_ALLOW_INSECURE_HTTP";

export const CONFIG_DIRECTORY = "waves";
export const CA_FILE_NAME = "ca.crt";
export const TOKEN_SUFFIX = ".token";
export const INSECURE_ENABLED = "1";

/** Everything a command needs before it can send anything: the origin, the certificate authority and where the tokens live. */
export interface Session {
  readonly endpoint: Endpoint;
  readonly ca?: string;
  readonly configDir: string;
}

export interface ProjectToken {
  readonly project: string;
  readonly token: string;
}

function optional(env: Environment, name: string): string | undefined {
  const value = env.get(name);
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return value.trim();
}

export function tokenPath(configDir: string, project: string): string {
  return `${configDir}/${project}${TOKEN_SUFFIX}`;
}

/**
 * Reads the environment into the three things every authenticated command needs.
 * Nothing is resolved lazily afterwards: a missing `WAVES_URL` or an unreadable
 * certificate authority is a usage error, and the user is told before a token
 * is read from disk.
 */
export async function openSession(
  env: Environment,
  files: Files,
): Promise<Session> {
  const raw = env.get(URL_VARIABLE);
  if (raw === undefined) {
    throw new UsageError(`${URL_VARIABLE} is required`);
  }
  const parsed = readEndpoint(
    raw,
    optional(env, ALLOW_INSECURE_VARIABLE) === INSECURE_ENABLED,
  );
  if (!parsed.ok) {
    throw new UsageError(`${URL_VARIABLE} ${parsed.error}`);
  }
  const configDir =
    optional(env, CONFIG_DIR_VARIABLE) ??
    `${env.home()}/.config/${CONFIG_DIRECTORY}`;
  return {
    endpoint: parsed.endpoint,
    ca: await readCertificateAuthority(env, files, configDir),
    configDir,
  };
}

/**
 * The private certificate authority to verify the server with, or `undefined`
 * to use the system store. A configured `WAVES_CA_FILE` that is not readable is
 * an error rather than a fallback: falling back would verify the server against
 * a store the operator did not ask for.
 */
async function readCertificateAuthority(
  env: Environment,
  files: Files,
  configDir: string,
): Promise<string | undefined> {
  const configured = optional(env, CA_FILE_VARIABLE);
  const path = configured ?? `${configDir}/${CA_FILE_NAME}`;
  const pem = await files.readText(path);
  if (pem === undefined) {
    if (configured === undefined) {
      return undefined;
    }
    throw new UsageError(`${CA_FILE_VARIABLE} ${path} cannot be read`);
  }
  return pem;
}

export function readProject(env: Environment): string {
  const project = optional(env, PROJECT_VARIABLE);
  if (project === undefined) {
    throw new UsageError(`${PROJECT_VARIABLE} is required`);
  }
  if (!isProjectId(project)) {
    throw new UsageError(`${PROJECT_VARIABLE} ${project} is not a project id`);
  }
  return project;
}

/**
 * The token of `WAVES_PROJECT`, read from the config directory. Whether the file
 * can be trusted at all — a link, another owner, a loose mode — is settled by
 * the adapter that opens it, which refuses with the reason rather than handing
 * over whatever it found.
 */
export async function readProjectToken(
  session: Session,
  files: Files,
  env: Environment,
): Promise<ProjectToken> {
  const project = readProject(env);
  const path = tokenPath(session.configDir, project);
  const file = await files.readSecret(path);
  if (file === undefined) {
    throw new UsageError(
      `no token for ${project} at ${path}; run waves register first`,
    );
  }
  const token = file.text.trim();
  if (token === "") {
    throw new UsageError(`${path} is empty`);
  }
  return { project, token };
}

/**
 * The transport for this run. An insecurely allowed host announces itself on
 * every single request, so the warning belongs here rather than in the middle
 * of a retry loop where it would be easy to reach once and skip afterwards.
 */
export function transportFor(
  session: Session,
  deps: Pick<UseCaseDeps, "transport" | "err">,
): Transport {
  const { endpoint } = session;
  return deps.transport({
    origin: endpoint.origin,
    ca: session.ca,
    warnInsecure: endpoint.warnInsecure
      ? () => {
          deps.err(insecureWarning(endpoint.origin));
        }
      : undefined,
  });
}
