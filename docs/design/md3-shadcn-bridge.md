# Bridging shadcn and Material Design 3

A design system guide for the DTS web client.

---

## Why these two things fit together

shadcn/ui is not a component library. It is a set of files you own: unstyled Radix primitives, a
`cva` variant map, and Tailwind classes, pasted into your repo and edited freely. Material Design 3
is the opposite kind of artefact — a specification of roles, tones, scales and curves, with no
opinion about your framework.

That is precisely why the pairing works. shadcn has structure and no vocabulary; MD3 has vocabulary
and no structure. Neither has to lose anything: Radix keeps supplying the focus management, the ARIA
wiring and the keyboard behaviour, Tailwind keeps supplying the authoring surface, and MD3 supplies
what shadcn deliberately leaves blank — what the colours *mean*.

The alternative — adopting Material Web Components — would mean giving up the code-first premise
entirely: Shadow DOM you cannot reach into, a second accessibility implementation to reconcile with
Radix, and a styling model that fights Tailwind. We take MD3's semantics and leave its runtime.

### The one rule that makes it work

**shadcn's semantic names are aliases, not values.**

```
MD3 tonal palette  →  MD3 role  →  shadcn semantic name  →  component class
oklch(40% .105 164) → --md-primary → --primary → bg-primary
```

Every component in `components/ui` keeps saying `bg-card`, `text-muted-foreground`, `border-border`.
Those names now resolve to MD3 roles. The payoff is concrete: **a component pasted unmodified from
the shadcn registry comes out looking like Material.** If you find yourself editing a registry
component's colours by hand, the bridge is missing a mapping — fix the bridge, not the component.

Three mappings in `app/md3-theme.css` are worth knowing because they are not one-to-one:

| shadcn | MD3 role | Why |
|---|---|---|
| `--card` | `surface-container-high` | A card is raised **by tone**. This single line is what lets cards drop their shadow. |
| `--accent` | `secondary-container` | shadcn's `accent` is the hover *surface*, not a brand accent. Pointing it at the brand colour repaints every hover state. |
| `--border` | `outline-variant` | `outline` (tone 50) is for a border that *is* the affordance. A row divider wants the quiet one, or a table becomes a grid of boxes. |

---

## 1. Tonal elevation: lifting with colour, not shadow

### The idea

In Material 2, elevation was a drop shadow. In MD3 it is a **tone**: a raised surface is the base
surface with more primary mixed into it. Shadows still exist, but only for the few things that
genuinely float, and they are far lighter than you are used to.

The reason is dark mode. A drop shadow works by darkening what is behind an element — against a
near-black surface there is nothing left to darken, so every dark-mode Material 2 app flattened into
an undifferentiated sheet. Tone has no such failure mode: it reads in both schemes, and it reads for
someone who cannot perceive a 4% luminance gradient at all.

### The implementation

Five levels, each a `color-mix` of primary into the surface:

```css
--md-elevation-1: color-mix(in oklab, var(--md-primary) 5%, var(--md-surface));
--md-elevation-2: color-mix(in oklab, var(--md-primary) 8%, var(--md-surface));
/* …through level 5 at 14% */
```

Dark mode mixes **more** at every level (8 / 12 / 16 / 18 / 22%). This is not a tuning accident: you
cannot lift a dark surface by adding white without washing it out, so MD3 lifts it by adding hue,
and the hue has to work harder against a dark ground.

Note `in oklab`. Mixing in sRGB passes through a muddy middle on the way between two colours;
mixing in a perceptual space does not. It is one keyword, and it is the difference between a
believable surface and a dirty one.

### The rules

1. **Reach for a surface container tone first.** `surface-container-low` (page) →
   `surface-container-high` (card) → `surface-container-highest` (nested) is the normal ladder. It
   covers almost everything.
2. **Use `bg-elevation-*` for things that move.** A menu, a dialog, a drag preview — anything whose
   elevation is a *state* rather than a *position*.
3. **A shadow is an edge-catcher, never the separator.** If removing `shadow-md3-1` makes an element
   disappear into its background, the element is on the wrong tone. Fix the tone.
4. **Never `shadow-md` or `shadow-lg`.** Tailwind's own shadows are two to three times heavier than
   anything MD3 casts. They are not removed from the project, because removing them would break
   third-party snippets — but a code review should treat one as a defect. The MD3 pairs are namespaced
   `shadow-md3-1` … `shadow-md3-5` specifically so they cannot be reached for by habit.
5. **Elevation is not emphasis.** Raising a card does not make its content more important; it says
   the card is *in front*. Use type scale and colour role for emphasis.

### Why only one shadow level in practice

In this app, `elevated` is a variant you will use perhaps twice: a floating action, a drag preview.
Everything else — cards, panels, the topbar, table rows — separates by tone. If half your screens
use `elevated`, you have rebuilt Material 2 with extra steps.

---

## 2. Motion: easing that matches the direction of travel

### The idea

MD3's curves are asymmetric by design. Something **entering** the screen decelerates — it arrives
and settles. Something **leaving** accelerates — it gets out of the way. Using one curve for both is
the single most common MD3 mistake, and it is why so many "Material-ish" interfaces feel slightly
wrong without anyone being able to say why.

### The tokens

| Token | Curve | Use for |
|---|---|---|
| `ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Ambient movement, state layers, colour changes |
| `ease-standard-decelerate` | `cubic-bezier(0, 0, 0, 1)` | Simple entrances |
| `ease-standard-accelerate` | `cubic-bezier(0.3, 0, 1, 1)` | Simple exits |
| `ease-emphasized-decelerate` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | Entrances the user initiated — dialogs, sheets, expansions |
| `ease-emphasized-accelerate` | `cubic-bezier(0.3, 0, 0.8, 0.15)` | The matching exits |

Durations are MD3's: `short-2` (100ms) for a state layer, `short-4` (200ms) for a small transition,
`medium-1`–`medium-4` (250–400ms) for a dialog or sheet, `long-*` (450ms+) for large transforms.
**Larger things move for longer.** A full-screen sheet at 100ms reads as a glitch; a 16px chevron at
400ms reads as lag.

### The rules

1. **Pick the curve by direction, not by habit.** Enter decelerates, exit accelerates. If a
   transition does both with one curve, it is wrong.
2. **`emphasized` for user-initiated, `standard` for ambient.** The user clicked a button and a
   dialog appeared: emphasized. The theme changed underneath them: standard.
3. **Animate colour and transform. Never size.** The components here transition
   `[color,background-color,border-color,box-shadow]` explicitly rather than using `transition-all`
   — a row of buttons that reflows on hover is a worse bug than no animation at all, and
   `transition-all` will eventually animate something that reflows.
4. **Reduced motion means reduced, not removed.** `prefers-reduced-motion` drops durations to 1ms
   and keeps every colour and state change. Removing the state layer outright would strip the
   affordance that tells someone their click registered — which makes the interface *less*
   accessible, not more.

### Where Radix fits

Radix sets `data-state="open|closed"` on every overlay. The `tw-animate-css` keyframes
(`animate-in`, `fade-out-0`, `slide-in-from-bottom`) hang off those attributes. So MD3 motion is
applied by pairing a Radix state with an MD3 curve:

```tsx
'data-[state=open]:animate-in data-[state=open]:ease-emphasized-decelerate data-[state=open]:duration-medium-2',
'data-[state=closed]:animate-out data-[state=closed]:ease-emphasized-accelerate data-[state=closed]:duration-short-4',
```

Note the asymmetry in the durations too: the exit is faster than the entrance. Dismissal should feel
immediate; arrival should feel considered.

---

## 3. Contrast and accessibility

### What the tonal system gives you for free

MD3's role pairs are defined at tone distances that clear WCAG by construction — `primary` (tone 40)
with `on-primary` (tone 100), `surface` (98) with `on-surface` (10). You get accessible contrast not
by checking each colour but by **using the pairs as pairs**.

This matters most for the accent presets. Nine user-selectable accents could have been nine
contrast audits. Because every preset is only a hue and a chroma fed into the same tone
assignments, there is one audit covering all of them.

Measured in-browser across all nine accents in both schemes (18 combinations):

| Pair | Required | Measured range |
|---|---|---|
| `primary` / `on-primary` | 4.5:1 | **8.56 – 9.73** |
| `surface` / `on-surface` | 4.5:1 | **15.42 – 19.51** |
| `surface-container-high` / `on-surface-variant` | 4.5:1 | **10.19 – 10.83** |
| `secondary-container` / `on-secondary-container` | 4.5:1 | **10.06 – 15.35** |
| `error` / `on-error` | 4.5:1 | **9.36 – 9.94** |
| `outline` / `surface` (non-text) | 3:1 | **5.22 – 5.73** |

Every pair clears AA, and every text pair clears AAA. The weakest result in the whole matrix is the
outline at 5.22:1 against a 3:1 requirement.

### The rules

1. **Never mix a role with a foreign surface.** `text-on-primary` belongs on `bg-primary` and
   nowhere else. The moment you put `on-primary` on a surface tone, you have left the system and the
   guarantee above no longer applies to you.
2. **Colour is never the only signal.** WCAG 1.4.1. The accent swatches in the appearance picker
   carry text labels and `aria-pressed`; the selected density carries a checkmark. A status conveyed
   only by a tone is a defect.
3. **Do not fade to disable.** `opacity-50` on a filled button fades its *background* too, so a
   disabled button on a tinted card lets the card show through. MD3's rule — container at
   `on-surface/12`, label at `on-surface/38` — keeps both opaque. (Note that 38% is deliberately
   below the contrast floor: a disabled control is exempt under WCAG 1.4.3, and *looking*
   unavailable is the point.)
4. **One focus treatment, app-wide.** A 2px `outline` in `--md-primary` at `outline-offset: 2px`,
   set once on `:focus-visible` in `theme.css`. It clears SC 1.4.11's 3:1 against every container
   tone for every accent. Resist per-component focus rings; they drift.
5. **`minimal` density is a floor, not a slider.** It holds controls at 32px, comfortably above
   SC 2.5.8's 24×24 CSS-px target. There is no tighter step, and adding one would be a regression.
6. **Density never touches the type scale.** Shrinking text along with spacing is how a comfort
   setting becomes an accessibility complaint, and it breaks SC 1.4.4 resize behaviour. `minimal`
   tightens space only.
7. **`color-scheme` is not optional.** Without it the browser keeps painting light scrollbars,
   light form controls and a light autofill wash over a dark app.

### The state layer is an accessibility feature

```css
.md3-state-layer::after {
  background-color: currentColor;  /* the element's own content colour */
  opacity: 0;                      /* → .08 hover, .10 focus/pressed */
}
```

Because the overlay is tinted with `currentColor`, one rule covers every variant: a filled button's
layer is `on-primary`, a text button's is `primary`, a menu item's is `on-surface`. None of them
needs to know the others exist.

Compare shadcn's stock approach, `hover:bg-primary/90`. It breaks in three places this does not:
over a translucent or image background (the `/90` blends with the page, not the button), under the
accent presets (every variant would need its own re-derived hover), and for `focus-visible`, which
in practice simply does not get a hover-equivalent treatment. The state layer gives focus, hover,
pressed and open each a defined visual weight — which is what a keyboard user needs and what a
colour-per-variant approach keeps forgetting.

---

## 4. Working in the system

**Reach for a role before a tone.** `bg-primary-container`, not `bg-tone-primary-90`. The raw tone
stops exist for charts and status scales; a tone used directly is a token that will not follow a
future scheme change.

**Reach for a semantic before a role.** If shadcn has a name for it (`bg-card`, `border-border`),
use that — it is what keeps registry components working.

**Three independent axes.** Mode × accent × density = 54 looks, out of nine lines of CSS per accent
and six tokens per density. They are independent *by construction*: palettes derive from a hue and a
chroma so an accent needs no per-mode definition, and density only ever touches spacing. Keep it
that way — a rule that reads two axes at once is the first crack.

**Two files own everything.** `app/md3-theme.css` holds the tokens; `tailwind.config.js` mirrors
them for tooling and is *not* the build's source of truth (this project is Tailwind v4 — `@theme`
is). If you change one, change both.

**One gotcha worth remembering.** `tailwind-merge` does not know the MD3 type roles, so it files
`text-label-large` under *text colour* and `cn('text-label-large', 'text-primary-foreground')`
silently drops the font size. `src/lib/utils.ts` extends it with the fifteen roles. Add a role to
the stylesheet and you must add it there too — nothing will error; it will just go missing.

---

## Appendix: token quick reference

**Colour roles** — `primary` `on-primary` `primary-container` `on-primary-container` ·
`secondary` · `tertiary` · `error` (all four with the same four-part shape) · `surface`
`on-surface` `on-surface-variant` `surface-dim` `surface-bright` ·
`surface-container-{lowest,low,DEFAULT,high,highest}` · `outline` `outline-variant` ·
`inverse-surface` `inverse-on-surface` `inverse-primary` `scrim`

**Elevation** — `bg-elevation-{0..5}`, `shadow-md3-{1..5}`

**Type** — `text-{display,headline,title,body,label}-{large,medium,small}`

**Shape** — `rounded-md3-{none,xs,sm,md,lg,xl}`, `rounded-full`

**Motion** — `ease-{standard,emphasized}[-decelerate|-accelerate]`,
`duration-{short,medium,long}-{1..4}`

**Density** — `h-control` `size-control` `px-control` `gap-control-gap` `p-card` `gap-card-gap`
`gap-section`

**State** — `.md3-state-layer` (hover 8% · focus 10% · pressed 10% · dragged 16%)
