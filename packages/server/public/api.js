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
    lanes: (projectId, all) => readJson(fetchImpl, lanesPath(projectId, all)),
    // One wave on its own, for the drawer in lane K6 and nothing else: the page
    // itself never asks for it, and keeps it because that lane will.
    wave: (projectId, waveId) =>
      readJson(fetchImpl, wavePath(projectId, waveId)),
    // What a project last said about itself. `undefined` for a 404, which the
    // project page reads as "it has pushed none" rather than as a failure: the
    // route is optional where the others are not.
    status: (projectId) => readJson(fetchImpl, statusPath(projectId)),
  };
}
