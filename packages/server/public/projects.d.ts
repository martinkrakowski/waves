import type { ProjectCard } from "./api.js";

export declare function projectPath(projectId: string): string;

export declare function projectList(
  projects: readonly ProjectCard[],
  nowMs: number,
): HTMLElement;
