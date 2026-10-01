import { el, internalLink, repoLink, stamp, text } from "./dom.js";
import { waveCountText } from "./format.js";

const PROJECT_PREFIX = "/p/";
const NO_REPO = "no repository registered";

export function projectPath(projectId) {
  return `${PROJECT_PREFIX}${encodeURIComponent(projectId)}`;
}

function pushTime(lastPush, nowMs) {
  return lastPush === undefined ? text("never") : stamp(lastPush, nowMs);
}

function fact(term, value) {
  return el("div", {
    attrs: { class: "fact" },
    children: [el("dt", { text: term }), el("dd", { children: [value] })],
  });
}

function card(project, nowMs) {
  const name = el("h2", {
    attrs: { class: "card-name" },
    children: [internalLink(project.name, projectPath(project.id))],
  });
  if (project.stale === true) {
    name.append(el("span", { attrs: { class: "badge stale" }, text: "stale" }));
  }
  return el("li", {
    attrs: { class: "card" },
    children: [
      name,
      el("dl", {
        attrs: { class: "facts" },
        children: [
          fact("id", el("code", { text: project.id })),
          fact("repo", repoLink(project.repo ?? NO_REPO, project.repo)),
          fact("waves", text(waveCountText(project.waves))),
          fact("last push", pushTime(project.lastPush, nowMs)),
        ],
      }),
    ],
  });
}

export function projectList(projects, nowMs) {
  const heading = [el("h1", { text: "waves" })];
  if (projects.length > 0) {
    heading.push(
      el("p", {
        attrs: { class: "count" },
        text:
          projects.length === 1 ? "1 project" : `${projects.length} projects`,
      }),
    );
  }
  const body =
    projects.length === 0
      ? el("p", {
          attrs: { class: "empty" },
          text: "No projects registered yet.",
        })
      : el("ul", {
          attrs: { class: "cards" },
          children: projects.map((project) => card(project, nowMs)),
        });
  return el("section", {
    attrs: { class: "view" },
    children: [...heading, body],
  });
}
