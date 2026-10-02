import type { ProjectCard } from "./api.js";
import type { Route } from "./app.js";

export interface ShellModel {
  readonly route: Route;
  /** The project list, or undefined before the first successful load. */
  readonly projects: readonly ProjectCard[] | undefined;
  /** "" or the offline note. */
  readonly note: string;
}

export declare function shell(model: ShellModel, body: Node): HTMLElement;
