/**
 * Reconciles a freshly built `.app` tree from `shell()` against the live `#root`
 * without detaching persistent `[role="status"]` live regions. Interactive
 * controls and links are still replaced with the newly rendered nodes so event
 * closures and focus restoration behave identically to a full redraw.
 */

function directChild(parent, className) {
  return Array.from(parent.children).find(
    (child) => child.className === className,
  );
}

function patchChildren(parent, desired, kept) {
  let cursor = parent.firstChild;
  for (const node of desired) {
    if (kept.has(node)) {
      while (cursor !== node) {
        const doomed = cursor;
        cursor = cursor.nextSibling;
        doomed.remove();
      }
      cursor = cursor.nextSibling;
    } else {
      parent.insertBefore(node, cursor);
    }
  }
  while (cursor !== null) {
    const doomed = cursor;
    cursor = cursor.nextSibling;
    doomed.remove();
  }
}

function syncTextRegion(current, next) {
  if (current.textContent !== next.textContent) {
    current.textContent = next.textContent;
  }
}

function bannerStamp(banner) {
  const stamped = Array.from(banner.children).find((child) =>
    child.hasAttribute("title"),
  );
  return stamped === undefined ? "" : stamped.getAttribute("title");
}

function syncBanner(current, next) {
  if (
    current.textContent !== next.textContent ||
    bannerStamp(current) !== bannerStamp(next)
  ) {
    current.replaceChildren(...next.childNodes);
  }
}

function syncToolbar(current, next) {
  const shown = directChild(current, "shown");
  const nextShown = directChild(next, "shown");
  const copied = directChild(current, "copied");
  const nextCopied = directChild(next, "copied");
  syncTextRegion(shown, nextShown);
  syncTextRegion(copied, nextCopied);
  const desired = Array.from(next.childNodes, (child) => {
    if (child === nextShown) {
      return shown;
    }
    if (child === nextCopied) {
      return copied;
    }
    return child;
  });
  patchChildren(current, desired, new Set([shown, copied]));
}

function keepBanner(current, next, kept) {
  const banner = directChild(current, "banner stale");
  const nextBanner = directChild(next, "banner stale");
  if (banner === undefined || nextBanner === undefined) {
    return undefined;
  }
  syncBanner(banner, nextBanner);
  kept.add(banner);
  return { current: banner, next: nextBanner };
}

function keepToolbar(current, next, kept) {
  const toolbar = directChild(current, "toolbar");
  const nextToolbar = directChild(next, "toolbar");
  if (toolbar === undefined || nextToolbar === undefined) {
    return undefined;
  }
  syncToolbar(toolbar, nextToolbar);
  kept.add(toolbar);
  return { current: toolbar, next: nextToolbar };
}

function syncProjectView(current, next) {
  const kept = new Set();
  const banner = keepBanner(current, next, kept);
  const toolbar = keepToolbar(current, next, kept);
  const desired = Array.from(next.childNodes, (child) => {
    if (banner !== undefined && child === banner.next) {
      return banner.current;
    }
    if (toolbar !== undefined && child === toolbar.next) {
      return toolbar.current;
    }
    return child;
  });
  patchChildren(current, desired, kept);
}

function syncPage(page, nextPage) {
  const current = directChild(page, "view project");
  const next = directChild(nextPage, "view project");
  if (current !== undefined && next !== undefined) {
    syncProjectView(current, next);
    patchChildren(page, [current], new Set([current]));
    return;
  }
  page.replaceChildren(...nextPage.childNodes);
}

function syncFootbar(footbar, nextFootbar) {
  const current = footbar.firstElementChild;
  const next = nextFootbar.firstElementChild;
  const nextClass = next.className === "note" ? "note" : "status";
  if (current.className !== nextClass) {
    current.setAttribute("class", nextClass);
  }
  syncTextRegion(current, next);
}

export function mountFrame(root, nextApp) {
  const currentApp = directChild(root, "app");
  if (currentApp === undefined) {
    root.replaceChildren(nextApp);
    return;
  }
  patchChildren(root, [currentApp], new Set([currentApp]));
  const topbar = directChild(currentApp, "topbar");
  const nextTopbar = directChild(nextApp, "topbar");
  topbar.replaceChildren(...nextTopbar.childNodes);
  syncPage(directChild(currentApp, "page"), directChild(nextApp, "page"));
  syncFootbar(
    directChild(currentApp, "footbar"),
    directChild(nextApp, "footbar"),
  );
}
