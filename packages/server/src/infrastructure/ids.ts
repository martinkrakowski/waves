import { isProjectId, isWaveId } from "@hexagen-monaco/waves-contract";

export function assertIds(project: string, wave?: string): string {
  if (!isProjectId(project)) {
    throw new Error(`invalid project id: ${JSON.stringify(project)}`);
  }
  if (wave !== undefined && !isWaveId(wave)) {
    throw new Error(`invalid wave id: ${JSON.stringify(wave)}`);
  }
  return project;
}
