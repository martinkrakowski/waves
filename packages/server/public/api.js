const JSON_HEADERS = { accept: "application/json" };

function projectsPath() {
  return "/api/v1/projects";
}

/** One project's lanes, with the waves past retention when `all` is asked for. */
function lanesPath(projectId, all) {
  const lanes = `/api/v1/projects/${encodeURIComponent(projectId)}/lanes`;
  return all ? `${lanes}?all=1` : lanes;
}

function wavePath(projectId, waveId) {
  const project = `/api/v1/projects/${encodeURIComponent(projectId)}`;
  return `${project}/waves/${encodeURIComponent(waveId)}`;
}

/**
 * A project's own status document, which is about the project rather than about
 * any one of its waves.
 */
function statusPath(projectId) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/status`;
}

/** One decision's full record: head, revisions and entries. */
function decisionPath(projectId, decisionId) {
  const project = `/api/v1/projects/${encodeURIComponent(projectId)}`;
  return `${project}/decisions/${encodeURIComponent(decisionId)}`;
}

/** A project's own decisions, with counts: the project inbox page. */
function projectDecisionsPath(projectId) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/decisions`;
}

async function readJson(fetchImpl, path) {
  const response = await fetchImpl(path, { headers: JSON_HEADERS });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`GET ${path} answered ${response.status}`);
  }
  return response.json();
}

export function createApi(fetchImpl) {
  return {
    projects: () => readJson(fetchImpl, projectsPath()),
    attention: () => readJson(fetchImpl, "/api/v1/attention"),
    inbox: () => readJson(fetchImpl, "/api/v1/inbox"),
    lanes: (projectId, all) => readJson(fetchImpl, lanesPath(projectId, all)),
    wave: (projectId, waveId) =>
      readJson(fetchImpl, wavePath(projectId, waveId)),
    status: (projectId) => readJson(fetchImpl, statusPath(projectId)),
    decision: (projectId, decisionId) =>
      readJson(fetchImpl, decisionPath(projectId, decisionId)),
    projectDecisions: (projectId) =>
      readJson(fetchImpl, projectDecisionsPath(projectId)),
  };
}
