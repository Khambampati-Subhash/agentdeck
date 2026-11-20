# Zig packages for CI

Copies of Zig packages that Ghostty fetches from hosts that can hang. CI runs
`zig fetch` on each one before building, so a cold cache never needs those
hosts. Zig stores each copy under the hash of its contents, so a copy only
stands in for a package whose pinned hash in `build.zig.zon` it matches.

- `translate_c-0.0.0-Q_BUW….tar.gz`: vancluever/translate-c at `4e879eb8`,
  from `pkg/translate-c/build.zig.zon` (codeberg.org, which stalled CI for
  45 to 60 minutes on 2026-11-20). MIT, Zig contributors.

When Ghostty bumps one of these, replace the file with the new package from
`~/.cache/zig/p/` after a local build.
