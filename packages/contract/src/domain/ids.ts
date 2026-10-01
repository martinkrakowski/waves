export type ProjectId = string;

export type WaveId = string;

export type LaneId = string;

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

const WAVE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

const MAX_PROJECT_ID_LENGTH = 63;

const MAX_WAVE_ID_LENGTH = 80;

export function isProjectId(id: string): boolean {
  if (id.length > MAX_PROJECT_ID_LENGTH) {
    return false;
  }
  return PROJECT_ID_PATTERN.test(id);
}

export function isWaveId(id: string): boolean {
  if (id.length > MAX_WAVE_ID_LENGTH) {
    return false;
  }
  return WAVE_ID_PATTERN.test(id);
}

export function isLaneId(id: string): boolean {
  if (id.length > MAX_WAVE_ID_LENGTH) {
    return false;
  }
  return WAVE_ID_PATTERN.test(id);
}
