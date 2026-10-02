'use client';

import * as React from 'react';
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  isAccent,
  isDensity,
  isMode,
  type Appearance,
} from './appearance-config';

export {
  ACCENTS,
  DENSITIES,
  MODES,
  DEFAULT_APPEARANCE,
  appearanceBootScript,
  type Accent,
  type Density,
  type Mode,
  type Appearance,
} from './appearance-config';

/*
 * The three appearance axes, and the one place that knows how they are stored.
 *
 * Mode, accent and density are independent by construction: md3-theme.css derives every palette
 * from a hue and a chroma, so an accent needs no per-mode definition, and density only ever touches
 * spacing tokens. Three attributes on <html>, and no combinatorial explosion of themes — nine
 * accents x three densities x two modes is 54 looks out of nine lines of CSS each.
 *
 * The choice is per-device, not per-account: it is a comfort setting like a zoom level, and round-
 * tripping it through the API would mean a flash of the wrong theme on every cold load while
 * /auth/me is in flight. If it later needs to follow the user across devices, `set` below is the
 * single write path to hook.
 */

function read(): Appearance {
  if (typeof window === 'undefined') return DEFAULT_APPEARANCE;
  try {
    const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_APPEARANCE;
    const { mode, accent, density } = parsed as Record<string, unknown>;
    /*
     * Validate rather than trust. The stored value is attacker-adjacent — anything with console
     * access can write it — and it is about to become a `data-accent` attribute. It is also just
     * robust: a value written by an older build whose preset has since been renamed falls back to
     * the default instead of leaving a half-themed page.
     */
    return {
      mode: isMode(mode) ? mode : DEFAULT_APPEARANCE.mode,
      accent: isAccent(accent) ? accent : DEFAULT_APPEARANCE.accent,
      density: isDensity(density) ? density : DEFAULT_APPEARANCE.density,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/**
 * The class that makes the repaint a movement rather than a cut, and the timer that takes it off.
 *
 * It has to come off: see md3-theme.css — left on, it would put a 300ms transition on every
 * element in the document and every hover in the app would lag behind the pointer. The timer is
 * module-level and cleared on each call so that flipping the switch twice quickly extends one
 * handover instead of ending it early with the first change still mid-flight.
 */
const SWITCHING_CLASS = 'md3-appearance-switching';
const SWITCH_MS = 300;
let switchingTimer: number | undefined;

function beginSwitch(root: HTMLElement) {
  root.classList.add(SWITCHING_CLASS);
  window.clearTimeout(switchingTimer);
  switchingTimer = window.setTimeout(() => {
    root.classList.remove(SWITCHING_CLASS);
  }, SWITCH_MS);
}

function apply(next: Appearance, animate = false) {
  const root = document.documentElement;
  // Added BEFORE the attributes change, so the transition is already in force when the values it
  // is meant to carry are swapped. After, and the first frame has already cut.
  if (animate) beginSwitch(root);
  root.dataset.accent = next.accent;
  root.dataset.density = next.density;
  // `system` means *no* attribute, which is what lets the `prefers-color-scheme` block in
  // md3-theme.css take over. Writing `data-theme="system"` would match neither branch.
  if (next.mode === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = next.mode;
}

type AppearanceContext = Appearance & {
  /** The resolved light/dark, with `system` collapsed against the OS. For UI that must know. */
  resolvedMode: 'light' | 'dark';
  set: (patch: Partial<Appearance>) => void;
  reset: () => void;
};

const Ctx = React.createContext<AppearanceContext | null>(null);

export function AppearanceProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  /*
   * Seeded with the DEFAULT, not with `read()`, even though `read()` is the stored truth.
   *
   * The server has no localStorage, so a `read()` seed would produce different markup on the two
   * sides and React would warn about a hydration mismatch. The boot script has already put the
   * right attributes on <html> by this point, so the page LOOKS correct throughout; this state only
   * has to catch up in time to render the picker's checkmarks, which the effect below does.
   */
  const [appearance, setAppearance] = React.useState<Appearance>(DEFAULT_APPEARANCE);
  const [systemDark, setSystemDark] = React.useState(false);

  React.useEffect(() => {
    setAppearance(read());
  }, []);

  React.useEffect(() => {
    /*
     * Feature-detected rather than assumed. `matchMedia` is absent in jsdom and in a few embedded
     * webviews, and the only thing it feeds here is which icon the picker shows while the mode is
     * `system` — the actual theming is done by the `prefers-color-scheme` block in the stylesheet,
     * which needs no JavaScript. So a missing API costs a cosmetic detail, and must not cost the
     * whole provider.
     */
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const set = React.useCallback((patch: Partial<Appearance>) => {
    setAppearance((current) => {
      const next = { ...current, ...patch };
      apply(next, true);
      try {
        window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // A window that refuses storage still gets the theme for the rest of this session.
      }
      return next;
    });
  }, []);

  const reset = React.useCallback(() => {
    apply(DEFAULT_APPEARANCE, true);
    setAppearance(DEFAULT_APPEARANCE);
    try {
      window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    } catch {
      /* nothing to clean up */
    }
  }, []);

  const value = React.useMemo<AppearanceContext>(
    () => ({
      ...appearance,
      resolvedMode:
        appearance.mode === 'system' ? (systemDark ? 'dark' : 'light') : appearance.mode,
      set,
      reset,
    }),
    [appearance, systemDark, set, reset],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppearance(): AppearanceContext {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error('useAppearance must be used inside <AppearanceProvider>');
  return ctx;
}
