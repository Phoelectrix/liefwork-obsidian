# Contributing

Thanks for caring enough to read this. Liefwork is **source-available**
(see [LICENSE](LICENSE)) and developed in a private monorepo; this
repository is its curated release tree, republished at each release.

## Bug reports & ideas — yes, please
Open a GitHub issue. A vault-shape sketch (folders in, coral out) or a
console error makes most bugs reproducible in minutes. Feature ideas are
welcome too — the coral metaphor rewards good ones.

## Pull requests — talk first
PRs are possible but land differently than usual: changes are merged into
the private monorepo and flow back here at the next release, and every
contribution needs the signed [CLA](CLA.md) (it keeps the licensing —
including the LICENSE §12 future Apache-2.0 conversion — coherent).
So: **open an issue before writing code**, and we'll agree the shape of
the change first.

## Building
`bun install` at the root, `viewer/`, and `obsidian-plugin/`, then
`cd obsidian-plugin && npm run build` reproduces the released `main.js`.
`bun run test:all` runs the suites.

## Commercial & bespoke
For commercial licensing or bespoke work: **licensing@liefwork.com** —
see [liefwork.com/obsidian-plugin/commercial-licensing](https://liefwork.com/obsidian-plugin/commercial-licensing).
