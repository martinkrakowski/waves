/**
 * What the inbox page knows about the answer it was given, with no DOM in it:
 * the projects sorted with the ones that have decisions first, each split into
 * the three groups it draws, and the totals across all of them.
 *
 * It is a module of its own so the view below reads from one place, the way
 * `fleet-model` lets the fleet page's hero, its cards and its rows agree about
 * one project.
 */

/** One of the four counts, read with its single word — no singular form. */
function oneWord(count, word) {
  return `${count} ${word}`;
}

/**
 * The count that has a singular and a plural: "1 one-way door", "2 one-way doors"
 * and "0 one-way doors". The other three counts are states — "waiting",
 * "reported", "closed" — that read the same at one and at zero, so they take no
 * singular form and the line is the same for zero as for any other number.
 */
function doors(oneWay) {
  return oneWay === 1 ? `${oneWay} one-way door` : `${oneWay} one-way doors`;
}

/**
 * A project's four counts as one line, in the order the page reads them:
 * "3 waiting (1 one-way door) · 2 reported · 1 closed by a session". This is the
 * same wording for the page's own totals and for a project's own line, so a
 * reader never has to read two ways, and the four are never added to one number.
 *
 * On the project inbox page only, a `fromCount` — the heads in the three drawn
 * groups that carry `from` — appends " · N from another project" when there is
 * one, or " · N from other projects" when there are several. The four own counts
 * are unchanged: a count line on `/p/<project>/inbox` reads its own four counts
 * and then names the instructions raised against it, never summed into them.
 */
export function countLine(counts, fromCount) {
  let line =
    `${oneWord(counts.waiting, "waiting")} (${doors(counts.oneWay)})` +
    ` · ${oneWord(counts.reported, "reported")}` +
    ` · ${oneWord(counts.closed, "closed by a session")}`;
  if (fromCount !== undefined && fromCount > 0) {
    const noun = fromCount === 1 ? "another project" : "other projects";
    line += ` · ${fromCount} from ${noun}`;
  }
  return line;
}

/**
 * A project's decisions split into the three groups, in the order the page draws
 * them. The server already sorted them this way; this is a partition, not a
 * re-sort, so a card the reader is looking for does not jump past its neighbour.
 */
function groupDecisions(decisions) {
  const byGroup = { waiting: [], reported: [], closed: [] };
  for (const head of decisions) {
    const group = head.group;
    if (group === "waiting") {
      byGroup.waiting.push(head);
    } else if (group === "reported") {
      byGroup.reported.push(head);
    } else {
      // The shape check closes `group` to the three values above, so anything
      // that reaches here is `closed`: the last branch needs no test of its own.
      byGroup.closed.push(head);
    }
  }
  return byGroup;
}

/**
 * Projects with decisions first, the rest last: a project that has nothing is
 * said in one line, not in a block of zeros, so the eye skips it without reading
 * one. Among the ones that have them the order is oneWay descending, then waiting
 * descending, then name — the project with the most one-way doors and the most
 * waiting is the one the reader most needs to see first.
 */
function sortProjects(projects) {
  return projects.sort((left, right) => {
    const leftHas =
      left.waiting.length + left.reported.length + left.closed.length > 0;
    const rightHas =
      right.waiting.length + right.reported.length + right.closed.length > 0;
    if (leftHas !== rightHas) {
      return leftHas ? -1 : 1;
    }
    // Stable for the ones with nothing: they keep the order the answer gave.
    if (!leftHas) {
      return 0;
    }
    if (left.counts.oneWay !== right.counts.oneWay) {
      return right.counts.oneWay - left.counts.oneWay;
    }
    if (left.counts.waiting !== right.counts.waiting) {
      return right.counts.waiting - left.counts.waiting;
    }
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
}

/** The four counts summed across every project, as the totals line reads them. */
function totals(projects) {
  return projects.reduce(
    (acc, project) => ({
      waiting: acc.waiting + project.counts.waiting,
      oneWay: acc.oneWay + project.counts.oneWay,
      reported: acc.reported + project.counts.reported,
      closed: acc.closed + project.counts.closed,
    }),
    { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
  );
}

/**
 * The inbox's model, built from the checked response: the projects the page will
 * draw, sorted and split, and the four totals that headline it.
 */
export function inboxModel(view) {
  const projects = sortProjects(
    view.projects.map((project) => ({
      id: project.id,
      name: project.name,
      counts: project.counts,
      ...groupDecisions(project.decisions),
    })),
  );
  return { projects, totals: totals(view.projects) };
}
