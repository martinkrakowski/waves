import type { ProjectCard } from "./api.js";

export declare function drawableProjects(
  projects: unknown,
): projects is readonly ProjectCard[];
