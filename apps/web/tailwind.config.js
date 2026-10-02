/**
 * MD3 x shadcn token mirror, as a JavaScript config.
 *
 * READ THIS BEFORE EDITING. This app is on Tailwind v4, where the source of truth for tokens is
 * `@theme` in `app/md3-theme.css` — not this file. v4 needs no JS config to build, and this one is
 * NOT wired into the PostCSS pipeline by default. It exists for three real consumers:
 *
 *   1. Tooling that still reads a config object rather than parsing CSS — the Tailwind IntelliSense
 *      extension's custom-class completion, `tailwind-merge`'s class-group extensions, Storybook
 *      and Chromatic setups, and any codegen that wants the scale as data.
 *   2. Downstream packages in this monorepo (or a design-system export) still on Tailwind v3, which
 *      cannot read `@theme`.
 *   3. Anyone who deliberately wants the v3-style config path in v4, which is opted into with one
 *      line at the top of the stylesheet:  @config "../tailwind.config.js";
 *
 * If you opt in at (3), do it INSTEAD of the `@theme` blocks, not alongside them — running both
 * means two definitions of every token and the last one parsed wins, which is a confusing bug to
 * find. Keeping the two in sync is the cost of having this file at all; the token names below are
 * ordered to match md3-theme.css section for section so a diff is readable.
 *
 * Every colour is `var(--md-*)` rather than a literal. That is deliberate and is what preserves the
 * three independent axes — mode, accent preset, density — through this file: the cascade still does
 * the resolution at runtime, so `bg-primary` follows `[data-accent]` here exactly as it does in the
 * CSS. A config full of hex values would freeze the accent at build time and quietly break the
 * picker.
 *
 * @type {import('tailwindcss').Config}
 */
const config = {
  darkMode: [
    'variant',
    ['&:is(.dark *, .dark)', "&:is([data-theme='dark'] *, [data-theme='dark'])"],
  ],

  content: [
    './app/**/*.{ts,tsx,mdx}',
    './src/**/*.{ts,tsx}',
    // Components shared from the monorepo render here too, so their classes must be scanned or
    // they get tree-shaken out of the bundle.
    '../../packages/*/src/**/*.{ts,tsx}',
  ],

  theme: {
    extend: {
      colors: {
        // --- shadcn semantics, MD3-backed ------------------------------------------------------
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',

        // --- MD3 roles under their own names ---------------------------------------------------
        'on-primary': 'var(--md-on-primary)',
        'primary-container': 'var(--md-primary-container)',
        'on-primary-container': 'var(--md-on-primary-container)',
        'inverse-primary': 'var(--md-inverse-primary)',

        'on-secondary': 'var(--md-on-secondary)',
        'secondary-container': 'var(--md-secondary-container)',
        'on-secondary-container': 'var(--md-on-secondary-container)',

        tertiary: 'var(--md-tertiary)',
        'on-tertiary': 'var(--md-on-tertiary)',
        'tertiary-container': 'var(--md-tertiary-container)',
        'on-tertiary-container': 'var(--md-on-tertiary-container)',

        error: 'var(--md-error)',
        'on-error': 'var(--md-on-error)',
        'error-container': 'var(--md-error-container)',
        'on-error-container': 'var(--md-on-error-container)',

        surface: {
          DEFAULT: 'var(--md-surface)',
          dim: 'var(--md-surface-dim)',
          bright: 'var(--md-surface-bright)',
          // Written as a nested group so the v3 class names come out identical to the v4 ones:
          // `bg-surface-container-high`, `bg-surface-container-lowest`.
          container: {
            DEFAULT: 'var(--md-surface-container)',
            lowest: 'var(--md-surface-container-lowest)',
            low: 'var(--md-surface-container-low)',
            high: 'var(--md-surface-container-high)',
            highest: 'var(--md-surface-container-highest)',
          },
        },
        'on-surface': 'var(--md-on-surface)',
        'on-surface-variant': 'var(--md-on-surface-variant)',

        outline: {
          DEFAULT: 'var(--md-outline)',
          variant: 'var(--md-outline-variant)',
        },
        'inverse-surface': 'var(--md-inverse-surface)',
        'inverse-on-surface': 'var(--md-inverse-on-surface)',
        scrim: 'var(--md-scrim)',
        /* The scrim at MD3's 32%. A token rather than a `/32` modifier — see the bridge guide. */
        'scrim-veil': 'var(--md-scrim-veil)',

        // --- Tonal elevation, as background colours --------------------------------------------
        // `bg-elevation-2` instead of `shadow-md`. This is the heart of the MD3 port: the five
        // levels are surfaces with progressively more primary mixed in, so a raised element stays
        // flat and gains separation from tone. See md3-theme.css for why the dark scheme mixes in
        // more at every level.
        elevation: {
          0: 'var(--md-elevation-0)',
          1: 'var(--md-elevation-1)',
          2: 'var(--md-elevation-2)',
          3: 'var(--md-elevation-3)',
          4: 'var(--md-elevation-4)',
          5: 'var(--md-elevation-5)',
        },

        // --- Raw tone stops ---------------------------------------------------------------------
        // Escape hatches, for the rare component that needs a specific tone rather than a role —
        // a chart series, a status chip scale. Reach for a role first; a tone used directly is a
        // token that will not follow a future scheme change.
        tone: {
          'primary-10': 'var(--md-primary-10)',
          'primary-20': 'var(--md-primary-20)',
          'primary-30': 'var(--md-primary-30)',
          'primary-40': 'var(--md-primary-40)',
          'primary-50': 'var(--md-primary-50)',
          'primary-60': 'var(--md-primary-60)',
          'primary-70': 'var(--md-primary-70)',
          'primary-80': 'var(--md-primary-80)',
          'primary-90': 'var(--md-primary-90)',
          'primary-95': 'var(--md-primary-95)',
          'primary-99': 'var(--md-primary-99)',
        },

        // --- Brand marks ------------------------------------------------------------------------
        // Literal ink for the seal, the gold rule and the priority flag. These do NOT follow the
        // accent preset, which is the whole reason they are kept separate from `tertiary`.
        gold: 'var(--dts-gold)',
        ink: 'var(--dts-ink)',
        paper: 'var(--dts-paper)',
      },

      // --- Type scale ---------------------------------------------------------------------------
      // The fifteen MD3 roles. DM Sans stands in for Roboto; DM Serif Display is kept for the
      // display roles, where MD3 explicitly invites a brand face.
      fontSize: {
        'display-large': [
          '3.5625rem',
          { lineHeight: '4rem', letterSpacing: '-0.015625rem', fontWeight: '400' },
        ],
        'display-medium': [
          '2.8125rem',
          { lineHeight: '3.25rem', letterSpacing: '0rem', fontWeight: '400' },
        ],
        'display-small': [
          '2.25rem',
          { lineHeight: '2.75rem', letterSpacing: '0rem', fontWeight: '400' },
        ],

        'headline-large': [
          '2rem',
          { lineHeight: '2.5rem', letterSpacing: '0rem', fontWeight: '400' },
        ],
        'headline-medium': [
          '1.75rem',
          { lineHeight: '2.25rem', letterSpacing: '0rem', fontWeight: '400' },
        ],
        'headline-small': [
          '1.5rem',
          { lineHeight: '2rem', letterSpacing: '0rem', fontWeight: '400' },
        ],

        'title-large': [
          '1.375rem',
          { lineHeight: '1.75rem', letterSpacing: '0rem', fontWeight: '400' },
        ],
        'title-medium': [
          '1rem',
          { lineHeight: '1.5rem', letterSpacing: '0.009375rem', fontWeight: '500' },
        ],
        'title-small': [
          '0.875rem',
          { lineHeight: '1.25rem', letterSpacing: '0.00625rem', fontWeight: '500' },
        ],

        'body-large': [
          '1rem',
          { lineHeight: '1.5rem', letterSpacing: '0.03125rem', fontWeight: '400' },
        ],
        'body-medium': [
          '0.875rem',
          { lineHeight: '1.25rem', letterSpacing: '0.015625rem', fontWeight: '400' },
        ],
        'body-small': [
          '0.75rem',
          { lineHeight: '1rem', letterSpacing: '0.025rem', fontWeight: '400' },
        ],

        // label-large is the button's type role. Do not substitute `text-sm`: it carries neither
        // the 500 weight nor the 0.1px tracking that keeps an upper-ish label legible at 14px.
        'label-large': [
          '0.875rem',
          { lineHeight: '1.25rem', letterSpacing: '0.00625rem', fontWeight: '500' },
        ],
        'label-medium': [
          '0.75rem',
          { lineHeight: '1rem', letterSpacing: '0.03125rem', fontWeight: '500' },
        ],
        'label-small': [
          '0.6875rem',
          { lineHeight: '1rem', letterSpacing: '0.03125rem', fontWeight: '500' },
        ],
      },

      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        serif: ['DM Serif Display', 'Georgia', 'serif'],
      },

      // --- Shape scale --------------------------------------------------------------------------
      borderRadius: {
        // shadcn's four, re-based on the MD3 shape scale so registry components inherit it.
        sm: 'var(--md-shape-xs)',
        md: 'var(--md-shape-sm)',
        lg: 'var(--md-shape-md)',
        xl: 'var(--md-shape-lg)',
        '2xl': 'var(--md-shape-xl)',
        // MD3's own names, for new work.
        'md3-none': 'var(--md-shape-none)',
        'md3-xs': 'var(--md-shape-xs)',
        'md3-sm': 'var(--md-shape-sm)',
        'md3-md': 'var(--md-shape-md)',
        'md3-lg': 'var(--md-shape-lg)',
        'md3-xl': 'var(--md-shape-xl)',
      },

      // --- Elevation shadows --------------------------------------------------------------------
      // Named `md3-*` so they cannot be reached for by habit. `shadow-md` and `shadow-lg` are still
      // Tailwind's own and are two to three times heavier than anything MD3 casts; if you find
      // yourself typing one, you almost certainly want `bg-elevation-*` instead.
      boxShadow: {
        'md3-1': 'var(--md-shadow-1)',
        'md3-2': 'var(--md-shadow-2)',
        'md3-3': 'var(--md-shadow-3)',
        'md3-4': 'var(--md-shadow-4)',
        'md3-5': 'var(--md-shadow-5)',
      },

      // --- Motion -------------------------------------------------------------------------------
      transitionTimingFunction: {
        standard: 'var(--md-ease-standard)',
        'standard-decelerate': 'var(--md-ease-standard-decelerate)',
        'standard-accelerate': 'var(--md-ease-standard-accelerate)',
        emphasized: 'var(--md-ease-emphasized)',
        'emphasized-decelerate': 'var(--md-ease-emphasized-decelerate)',
        'emphasized-accelerate': 'var(--md-ease-emphasized-accelerate)',
      },

      transitionDuration: {
        'short-1': '50ms',
        'short-2': '100ms',
        'short-3': '150ms',
        'short-4': '200ms',
        'medium-1': '250ms',
        'medium-2': '300ms',
        'medium-3': '350ms',
        'medium-4': '400ms',
        'long-1': '450ms',
        'long-2': '500ms',
        'long-3': '550ms',
        'long-4': '600ms',
      },

      // --- Density ------------------------------------------------------------------------------
      // The four tokens `[data-density]` swaps. Components use `h-control` / `px-control` /
      // `p-card` on their default path, so one attribute on <html> retunes the app without a
      // single conditional in a component.
      spacing: {
        control: 'var(--md-density-control-px)',
        'control-gap': 'var(--md-density-control-gap)',
        card: 'var(--md-density-card-pad)',
        'card-gap': 'var(--md-density-card-gap)',
        section: 'var(--md-density-section-gap)',
      },

      height: {
        control: 'var(--md-density-control-h)',
        row: 'var(--md-density-row-h)',
      },

      minHeight: {
        control: 'var(--md-density-control-h)',
        // WCAG 2.2 SC 2.5.8 wants a 24x24 CSS-px target. The `minimal` density floors controls at
        // 32px for exactly this reason, and this token is the assertion of it.
        target: '1.5rem',
      },

      width: {
        control: 'var(--md-density-control-h)',
      },

      // --- Opacity ------------------------------------------------------------------------------
      // The MD3 state-layer and disabled opacities, so a one-off overlay can be written as
      // `opacity-state-hover` rather than as a magic `opacity-[0.08]`.
      opacity: {
        'state-hover': '0.08',
        'state-focus': '0.1',
        'state-pressed': '0.1',
        'state-dragged': '0.16',
        'disabled-content': '0.38',
        'disabled-container': '0.12',
      },
    },
  },

  plugins: [],
};

export default config;
