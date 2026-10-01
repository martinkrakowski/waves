import {
  validateProject,
  type ValidationIssue,
} from "@hexagen-monaco/waves-contract";

/**
 * The two fields a registration carries that the contract has rules for. The
 * id and the name are the user's; the token hash and the registration instant
 * are the server's own.
 */
export interface ProjectRequest {
  readonly id: string;
  readonly name: string;
  readonly repo?: string;
}

// The server fills these in when it stores a project. They are placeholders
// here only so that the contract can check the fields the client does own with
// the rules the server will apply to them.
const SERVER_OWNS = {
  tokenSha256: "0".repeat(64),
  registeredAt: "1970-01-01T00:00:00.000Z",
} as const;

const OWN_FIELDS = ["/id", "/name", "/repo"];

/** What each pointer is called at a shell, where a pointer means nothing. */
const FLAG_NAMES: Readonly<Record<string, string>> = {
  "/id": "the project id",
  "/name": "--name",
  "/repo": "--repo",
};

/**
 * What the contract says about a registration, using the contract's own rules
 * rather than a copy of them. Checking here means an admin token is never spent
 * on a request the server is going to refuse; nothing is sent until this is
 * empty.
 */
export function readProjectRequest(
  request: ProjectRequest,
): readonly ValidationIssue[] {
  const result = validateProject({
    id: request.id,
    name: request.name,
    repo: request.repo,
    ...SERVER_OWNS,
  });
  if (result.ok) {
    return [];
  }
  return result.errors.filter((issue) => OWN_FIELDS.includes(issue.path));
}

/**
 * The same refusals, phrased for someone standing at a shell. A contract
 * pointer such as `/name` means nothing in a command line, where the thing they
 * typed is `--name`, and the wording is left exactly as the contract writes it
 * so that the two answers to the same mistake cannot drift apart.
 */
export function flagIssues(
  issues: readonly ValidationIssue[],
): readonly string[] {
  return issues.map(
    (issue) => `${String(FLAG_NAMES[issue.path])}: ${issue.message}`,
  );
}
