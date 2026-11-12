// A unified diff (gh pr diff, glab mr diff) as files, each with numbered rows
// so a frame only draws the rows on screen. Rows mirror the changes mod's.

const MAX_ROWS = 4000, MAX_LINE = 4000;

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));
const clip = (text) => (text.length > MAX_LINE ? text.slice(0, MAX_LINE) + "…" : text);

export function diffRows(lines) {
  let old = 0, next = 0;
  return lines.slice(0, MAX_ROWS).map((line) => {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (m) { old = +m[1]; next = +m[2]; return { kind: "@", text: clip(line), number: null }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: clip(untab(line.slice(1))) || " " };
    if (kind === "+") return { kind, number: next++, text: clip(untab(line.slice(1))) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: clip(untab(line.slice(1))) || " " }; }
    return { kind: "", number: null, text: clip(line) };
  });
}

// Each file's header (index, ---/+++, modes) is dropped; what it says that
// matters (a binary file, a rename) stays as a plain row.
export function splitDiff(text) {
  const files = [];
  let file = null, inHunk = false;
  for (const line of text.replace(/\n$/, "").split("\n")) {
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (head) { file = { path: head[2], lines: [] }; files.push(file); inHunk = false; continue; }
    if (!file) { if (!line) continue; file = { path: "(diff)", lines: [] }; files.push(file); }
    if (line.startsWith("@@")) inHunk = true;
    if (inHunk) file.lines.push(line);
    else if (/^(Binary files|rename from|rename to)/.test(line)) file.lines.push(line);
  }
  return files.map(({ path, lines }) => {
    const rows = diffRows(lines);
    return { path, rows, add: rows.filter((r) => r.kind === "+").length, del: rows.filter((r) => r.kind === "-").length };
  });
}
