/**
 * What the fleet page knows about the answer in hand, with no DOM in it at all:
 * how many lanes each project is asking for, which tab it belongs to, whether
 * the reader's own search is looking for it, and the sums its row and its ring
 * are drawn from.
 *
 * It is a module of its own because both of the view's modules read from here.
 * The hero's line, the stat cards and the rows are then three readings of one
 * answer, so a counter and the row under it cannot disagree about the same
 * project — which is the only way a page of counters is worth reading.
 */

/** What one project is asking for, or nothing: the view has no entry for it. */
export function attentionOf(attention, projectId) {
  const found = attention.projects.find((entry) => entry.id === projectId);
  return found === undefined ? 0 : found.attention;
}

/**
 * Which tab one project is in, and it is the row's own dot as well: a reader who
 * cannot see the dot reads the word beside it, and both are this one answer.
 *
 * `flagged` is a failed newest wave or a lane asking for attention. **Staleness
 * is deliberately not one of the three tests**: every project's pushes stop
 * eventually — every finished wave goes stale when they do — so a rule that read
 * "stale" as "flagged" would put the whole fleet under one tab on any quiet day
 * and leave the other two empty. Staleness is still said, where it is about the
 * project rather than about the fleet: the row's own pill, and the projects
 * stat's caption.
 */
export function tabOf(project, attention) {
  const newest = project.recentWaves[0];
  if (
    (newest !== undefined && newest.state === "failed") ||
    attentionOf(attention, project.id) > 0
  ) {
    return "flagged";
  }
  return project.recentWaves.some((wave) => wave.state === "running")
    ? "active"
    : "quiet";
}

/**
 * How many projects are in each tab, over the whole fleet and before the search:
 * a tab's count is what it is about to show, so it cannot be the count of what a
 * search has already hidden. `all` is the fleet itself.
 */
export function tabCounts(projects, attention) {
  const counts = { all: projects.length, active: 0, flagged: 0, quiet: 0 };
  for (const project of projects) {
    counts[tabOf(project, attention)] += 1;
  }
  return counts;
}

/**
 * Whether one project is what the reader's own search is looking for: a
 * case-insensitive substring of its name, its id or its repository. The
 * repository is matched only when the project registered one — a project with
 * none has said nothing about a repository, and a search for a host name must
 * not match every project that never named one.
 */
export function matches(project, needle) {
  if (needle === undefined) {
    return true;
  }
  const wanted = needle.toLowerCase();
  return [project.name, project.id, project.repo ?? ""].some((field) =>
    field.toLowerCase().includes(wanted),
  );
}

/**
 * The two numbers a row's ring is drawn from, summed over the waves that row
 * lists. They are the *waves'* lanes and not the project's own: the ring is a
 * share of the work the reader can see in the bar beside it, and a project's
 * `lanes` counts every retained wave, including the ones past the twelve this
 * listing carries.
 */
export function ringOf(project) {
  return {
    lanes: sum(project.recentWaves.map((wave) => wave.lanes)),
    merged: sum(project.recentWaves.map((wave) => wave.merged)),
  };
}

/**
 * The seven numbers the hero's line and the four stat cards break down, counted
 * once so that the line of live counts and the cards under it cannot be two
 * answers to the same question. A filter narrows neither: they are about the
 * fleet, and a reader who filtered to one tab still wants to know what the other
 * two hold.
 */
export function totals(projects, attention) {
  const waves = projects.flatMap((project) => project.recentWaves);
  return {
    projects: projects.length,
    running: waves.filter((wave) => wave.state === "running").length,
    recent: waves.length,
    lanes: sum(projects.map((project) => project.lanes)),
    merged: sum(waves.map((wave) => wave.merged)),
    asking: sum(attention.projects.map((entry) => entry.attention)),
    stale: projects.filter((project) => project.stale === true).length,
  };
}

function sum(counts) {
  return counts.reduce((total, count) => total + count, 0);
}
