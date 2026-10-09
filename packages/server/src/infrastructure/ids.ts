import {
  isLaneId,
  isProjectId,
  isWaveId,
} from "@hexagen-monaco/waves-contract";

export function assertIds(project: string, wave?: string): string {
  if (!isProjectId(project)) {
    throw new Error(`invalid project id: ${JSON.stringify(project)}`);
  }
  if (wave !== undefined && !isWaveId(wave)) {
    throw new Error(`invalid wave id: ${JSON.stringify(wave)}`);
  }
  return project;
}

/**
 * A notice id is a lane id; the route validates it before it reaches the store,
 * and the store checks again so a malformed id is refused here too.
 */
export function assertNoticeIds(project: string, id: string): string {
  assertIds(project);
  if (!isLaneId(id)) {
    throw new Error(`invalid notice id: ${JSON.stringify(id)}`);
  }
  return project;
}
