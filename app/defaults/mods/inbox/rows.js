// Blocked agents as inbox rows, longest-waiting first.
export function inboxRows(agents, terminals, since, now) {
  const reports = new Map(terminals.map((t) => [t.address, t.report]));
  return agents
    .filter((a) => a.status === "blocked")
    .map((a) => {
      const report = reports.get(a.address);
      return {
        address: a.address, space: a.space, space_name: a.space_name, tab_name: a.tab_name,
        title: a.title, program: a.program,
        kind: report?.kind ?? null, msg: report?.msg ?? "",
        waited: now - (since[a.address] ?? now),
      };
    })
    // Array.sort is stable, so ties stay in agents() order.
    .sort((a, b) => b.waited - a.waited);
}

// When each agent started waiting; stamps of agents no longer blocked are dropped.
export function stamp(since, agents, now) {
  const next = {};
  for (const a of agents) if (a.status === "blocked") next[a.address] = since[a.address] ?? now;
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
