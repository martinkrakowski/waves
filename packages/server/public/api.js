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
  };
}
