const JSON_HEADERS = { accept: "application/json" };

function projectsPath() {
  return "/api/v1/projects";
}

/** One project's lanes, with the waves past retention when `all` is asked for. */
function lanesPath(projectId, all) {
  const lanes = `/api/v1/projects/${encodeURIComponent(projectId)}/lanes`;
  return all ? `${lanes}?all=1` : lanes;
}

function wavesPath(projectId) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/waves`;
}

function wavePath(projectId, waveId) {
  return `${wavesPath(projectId)}/${encodeURIComponent(waveId)}`;
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
    waves: (projectId) => readJson(fetchImpl, wavesPath(projectId)),
    wave: (projectId, waveId) =>
      readJson(fetchImpl, wavePath(projectId, waveId)),
  };
}
