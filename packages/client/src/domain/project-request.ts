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
