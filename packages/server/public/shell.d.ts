import type { AttentionView } from "../src/application/read-model.js";
import type { ProjectCard } from "./api.js";
import type { Route } from "./app.js";

export interface ShellModel {
  readonly route: Route;
  /** The project list, or undefined before the first successful load. */
  readonly projects: readonly ProjectCard[] | undefined;
  /** What the lanes are asking for, or undefined before the first load. */
  readonly attention: AttentionView | undefined;
  /**
   * Whether the reader has asked for the waves past retention. A link the shell
   * draws to a project carries it, so leaving the page does not quietly drop it.
   */
  readonly all: boolean;
  /** Whether the reader has the projects menu open; it is drawn closed otherwise. */
  readonly menuOpen: boolean;
  /** "" or the offline note. */
  readonly note: string;
}

export declare function shell(model: ShellModel, body: Node): HTMLElement;
