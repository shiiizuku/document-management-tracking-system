# Vendored typefaces

Two variable `woff2` files, one per family, for the Civic Ledger design
(`docs/design/civic-ledger-handoff.md`):

| File                         | Family      | Axes                        | Role                        |
| ---------------------------- | ----------- | --------------------------- | --------------------------- |
| `public-sans-variable.woff2` | Public Sans | `wght` 100–900              | UI and body (`--font-sans`) |
| `newsreader-variable.woff2`  | Newsreader  | `wght` 200–800, `opsz` 6–72 | Display (`--font-display`)  |

## Where they came from

Both are built from the variable TTFs in the official Google Fonts repository,
[google/fonts](https://github.com/google/fonts) on `main`:

- `ofl/publicsans/PublicSans[wght].ttf` (Public Sans 2.001, upstream
  [uswds/public-sans](https://github.com/uswds/public-sans)),
  sha256 `d75a7dc1a27eb9e336d5b33f55489d2ecb5621bf694d5c43b2415bce2ca830a8`
- `ofl/newsreader/Newsreader[opsz,wght].ttf` (Newsreader 1.003, upstream
  [productiontype/Newsreader](https://github.com/productiontype/Newsreader)),
  sha256 `8a08d13f8a6c0d51be379a60af84f945f65369a67e509ee3c3bdcc421254d7c1`

The repository ships TTF only, so each file was subset and compressed with
[fontTools](https://github.com/fonttools/fonttools) 4.66:

```sh
python -m fontTools.subset "<family>.ttf" \
  --unicodes="<Google Fonts' latin + latin-ext ranges>" \
  --layout-features='*' --flavor=woff2 --output-file=<file>.woff2
```

The unicode ranges are Google Fonts' own `latin` and `latin-ext` subsets combined (Filipino names
and place names are covered by Latin-1). Every OpenType feature is kept: `tnum`, which the tracking
numbers and counts depend on, is one of them. Both variable axes are kept whole. Italics are not
vendored; nothing in the design sets italic text in either family, and the browser's synthesized
oblique is acceptable for the one `<em>` on the sign-in panel.

## Why they are committed

Decision 172 asks for fonts **self-hosted**, and the reason is that an organization-hosted
deployment should have no third-party dependency in the critical render path — a build that
reaches a font registry to produce the bundle keeps that dependency, it only moves it from the
browser to CI. These files and `app/layout.tsx` are the whole of it.

`LICENSE-PublicSans.txt` and `LICENSE-Newsreader.txt` are the SIL Open Font License 1.1 texts the
families ship under (the `OFL.txt` beside each TTF upstream), and have to travel with the files.
Upgrading either family means rebuilding its `woff2` the same way and updating this note; nothing
else refers to a version.
