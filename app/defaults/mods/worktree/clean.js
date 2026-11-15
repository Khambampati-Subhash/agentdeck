// The clean action's pure parts: which linked worktrees there are, which
// branches origin deleted, and why each worktree may (or may not) go.

// Linked worktrees from `git worktree list --porcelain`: { path, branch, missing }.
// The first block is the main checkout and bare blocks have no files: neither
// is listed. `missing`: git marks it prunable, its folder is gone.
export function listAll(porcelain) {
  const out = [];
  porcelain.split(/\n\n+/).forEach((block, i) => {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (i === 0 || !path || lines.includes("bare")) return;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    out.push({ path, branch, missing: lines.some((l) => l.startsWith("prunable")) });
  });
  return out;
}

// Branches whose upstream is gone, from for-each-ref's
// `%(refname:short)%09%(upstream:track)` lines.
export function goneBranches(forEachRef) {
  return new Set(forEachRef.split("\n").map((l) => l.split("\t")).filter(([b, track]) => b && track === "[gone]").map(([b]) => b));
}

// Why a worktree is listed, whether it can be ticked, and whether it is
// already: f = { branch, missing, inUse, dirty, merged, gone, base }.
// First match wins: in use, uncommitted changes and a detached HEAD (its
// commits may be on no branch) are never removable. The base branch can be
// ticked by hand but is never "merged" (its branch is never deleted).
export function classify(f) {
  if (f.inUse) return { reason: `In use by ${f.inUse}`, selectable: false, picked: false };
  if (f.missing) return { reason: "Folder is gone", selectable: true, picked: true };
  if (f.dirty) return { reason: `${f.dirty} uncommitted change${f.dirty === 1 ? "" : "s"}`, selectable: false, picked: false };
  if (!f.branch) return { reason: "Detached HEAD; its commits could be lost", selectable: false, picked: false };
  if (f.branch === f.base) return { reason: "Base branch", selectable: true, picked: false };
  if (f.merged) return { reason: `Merged into ${f.base}`, selectable: true, picked: true };
  if (f.gone) return { reason: "Branch deleted on origin", selectable: true, picked: true };
  return { reason: "Not merged", selectable: true, picked: false };
}
