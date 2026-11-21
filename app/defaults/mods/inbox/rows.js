// What an agent asks, on one line and at most `cap` characters.
export function message(msg, cap = 300) {
  const m = (msg ?? "").replace(/\s+/g, " ").trim();
  return m.length > cap ? `${m.slice(0, cap).trimEnd()}…` : m;
}

// Blocked agents as inbox rows, longest-waiting first. A sub-agent without a pane
// isn't in agents(): it comes from terminals(), error counting as blocked (as in
// the Agents list), under its nearest listed ancestor's space and tab.
export function inboxRows(agents, terminals, since, now) {
  const byAddress = new Map(terminals.map((t) => [t.address, t]));
  const listed = new Map(agents.map((a) => [a.address, a]));
  const ancestor = (t) => {
    const seen = new Set();
    for (let p = t.parent; p && !seen.has(p); p = byAddress.get(p)?.parent) {
      if (listed.has(p)) return listed.get(p);
      seen.add(p);
    }
    return null;
  };
  const row = (address, where, fields) => {
    const report = byAddress.get(address)?.report;
    return {
      address, space: where?.space ?? null, space_name: where?.space_name ?? "", tab_name: where?.tab_name ?? "",
      kind: report?.kind ?? null, msg: message(report?.msg),
      waited: now - (since[address] ?? now),
      ...fields,
    };
  };
  const top = agents
    .filter((a) => a.status === "blocked")
    .map((a) => row(a.address, a, { title: a.title, program: a.program, label: a.program?.name ?? a.title ?? a.address }));
  const kids = terminals
    .filter((t) => t.parent && t.state === "live" && !listed.has(t.address) && (t.status === "blocked" || t.status === "error"))
    .map((t) => {
      const r = row(t.address, ancestor(t), { title: t.name ?? "", program: t.program, label: t.name || t.template || t.program?.name || t.address });
      if (!r.kind && t.status === "error") r.kind = "error";
      return r;
    });
  // Array.sort is stable, so ties stay in agents() order, sub-agents after.
  return [...top, ...kids].sort((a, b) => b.waited - a.waited);
}

// When each blocked address started waiting; stamps of the others are dropped.
export function stamp(since, addresses, now) {
  const next = {};
  for (const a of addresses) next[a] = since[a] ?? now;
  return next;
}

export function trimPreview(text, lines = 6, width = 200) {
  const kept = text.split("\n").map((l) => l.trimEnd()).filter((l) => l !== "");
  return kept.slice(-lines).map((l) => l.slice(0, width));
}

// Follow the selected agent when rows reorder; otherwise stay near the old index.
export function keepSelection(rows, address, index) {
  if (!rows.length) return -1;
  const at = rows.findIndex((r) => r.address === address);
  return at >= 0 ? at : Math.min(index, rows.length - 1);
}

// Whether a layout draws the mod: a node with it that isn't hidden, under no
// hidden node, and in a stack only under its active child.
export function draws(node, mod) {
  if (!node || typeof node !== "object" || node.hidden) return false;
  if (node.content?.mod === mod) return true;
  const kids = Array.isArray(node.children) ? node.children : [];
  const shown = node.type === "stack" ? kids.filter((k) => k?.id === node.active) : kids;
  return shown.some((k) => draws(k, mod));
}
