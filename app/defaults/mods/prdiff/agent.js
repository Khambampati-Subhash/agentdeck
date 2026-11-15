// Find and message agents on a PR's branch.

import { agents, panes, spaces, exec, hc } from "herdr";

/** Extract path from git remote URL and compare case-insensitively.
 *  Accepts git@host:path, ssh://[user@]host[:port]/path, https:// and http://;
 *  a trailing / goes first, then .git. prboard/issues.js and propen/git.js
 *  have copies (mods can't share files): keep the three the same. */
export function sameRepo(remote, repo) {
  remote = remote.trim();
  let path = "";
  if (remote.startsWith("git@")) path = remote.split(":")[1] || "";
  else if (/^(ssh|https?):\/\//.test(remote)) path = remote.split("/").slice(3).join("/");
  path = path.replace(/\/+$/, "").replace(/\.git$/, "");
  return path.toLowerCase() === repo.toLowerCase();
}

/** Find agents on the given branch in checkouts of the same repo.
 *  Returns Target[] with { address, name, cwd, on }. */
export async function agentsOn(branch, repo) {
  const allAgents = agents();
  const allPanes = panes();
  const allSpaces = spaces();

  const targets = [];

  for (const agent of allAgents) {
    const pane = allPanes.find(p => p.pane === agent.pane);
    if (!pane || pane.branch !== branch) continue;

    // Find the space to get the machine
    const space = allSpaces.find(s => s.id === agent.space);
    const on = space?.machine || null;

    // Get the remote URL for this pane's cwd
    try {
      const result = await exec("git", ["remote", "get-url", "origin"], { cwd: pane.cwd, on });
      if (result.code !== 0) continue;

      if (!sameRepo(result.stdout, repo)) continue;

      targets.push({
        address: agent.address,
        name: `${agent.tab_name} · ${agent.program.name}`,
        cwd: pane.cwd,
        on,
      });
    } catch {
      continue;
    }
  }

  return targets;
}

/** Send a message to an agent via hc send.
 *  Text goes after -- to protect flag-looking content. */
export async function tell(address, text) {
  const result = await hc(["send", address, "--", text]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
}

/** Format a review task for an agent. */
export function reviewTask(p, c) {
  const ref = p.forge === "gh" ? `#${p.pr.num}` : `!${p.pr.num}`;
  const location = c.path ? ` on ${c.path}:${c.line}` : "";
  return `Review comment on ${ref} (${p.pr.title}) by @${c.author}${location}:\n\n${c.body}\n\nAddress it on branch ${p.pr.branch}, commit, and push. Reply with what you changed.`;
}

/** Format a CI check failure task for an agent. */
export function checkTask(p, check, log) {
  const ref = p.forge === "gh" ? `#${p.pr.num}` : `!${p.pr.num}`;
  return `CI check "${check.name}" failed on ${ref} (${p.pr.title}), branch ${p.pr.branch}. The end of its log:\n\n\`\`\`\n${log}\n\`\`\`\n\nFind the cause, fix it on this branch, commit, and push.`;
}

/** Strip ANSI escape codes and \r, keep the last N lines and M chars. */
export function tail(text, lines = 120, chars = 8000) {
  // Strip ANSI escape codes and \r
  let clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");

  // Keep the last N lines
  const allLines = clean.split("\n");
  if (allLines.length > lines) {
    clean = allLines.slice(-lines).join("\n");
  }

  // Keep the last M chars
  if (clean.length > chars) {
    clean = clean.slice(-chars);
  }

  return clean;
}
