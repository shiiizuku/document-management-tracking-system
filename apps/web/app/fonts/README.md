# Vendored typefaces

Inter, as two variable `woff2` subsets, taken verbatim from
[`@fontsource-variable/inter@5.3.0`](https://www.npmjs.com/package/@fontsource-variable/inter)
(`files/inter-latin-wght-normal.woff2` and `files/inter-latin-ext-wght-normal.woff2`), which
packages the upstream [rsms/inter](https://github.com/rsms/inter) release.

Committed rather than installed. Decision 172 asks for Inter **self-hosted**, and the reason is
that an organization-hosted deployment should have no third-party dependency in the critical
render path — a build that reaches a font registry to produce the bundle keeps that dependency,
it only moves it from the browser to CI. These two files and `app/layout.tsx` are the whole of it.

`LICENSE-Inter.txt` is the SIL Open Font License 1.1 these files ship under, and has to travel
with them. Upgrading Inter means replacing both `woff2` files and this note; nothing else refers
to a version.
