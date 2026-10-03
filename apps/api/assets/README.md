# API assets

Binary files the API embeds in documents it renders. Loaded once into a module-level buffer at
first use, never read per request.

- **`mgb-seal.png`** — the organization's approved seal (decision 64), carried on the routing slip
  by decision 171. It is `apps/web/public/mgb-logo.png` resized from 2540×2540 to 256×256, which
  takes it from 1.3 MB to 34 kB; the original is far too large to embed in a PDF produced per
  request, and the slip prints it at about 60 pt.

  Replacing the seal for another bureau is a **deployment step, not a code change**: drop a new
  256×256 PNG in beside this note. The pilot configuration checklist records it as such.
