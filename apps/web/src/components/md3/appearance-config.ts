/*
 * The appearance vocabulary, and the boot script — deliberately in a module with NO `use client`.
 *
 * The root layout is a server component and needs `appearanceBootScript` to inline into <head>.
 * Pulling it out of appearance.tsx keeps that import off the client boundary: a server component
 * reaching into a `'use client'` module for a plain string works, but it drags the provider, the
 * hook and React itself into the graph for the sake of one constant. This way the layout imports a
 * string from a string module.
 */

export const ACCENTS = [
  { id: 'sage', label: 'Sage', note: 'The house green' },
  { id: 'slate', label: 'Slate', note: 'Cool blue-violet' },
  { id: 'mist', label: 'Mist', note: 'Soft blue' },
  { id: 'olive', label: 'Olive', note: 'Muted green' },
  { id: 'sand', label: 'Sand', note: 'Warm gold' },
  { id: 'clay', label: 'Clay', note: 'Warm terracotta' },
  { id: 'rose', label: 'Rose', note: 'Dusty pink' },
  { id: 'lilac', label: 'Lilac', note: 'Pale violet' },
  { id: 'graphite', label: 'Graphite', note: 'No colour' },
] as const;

export const DENSITIES = [
  { id: 'default', label: 'Comfortable', note: '40px controls, roomy cards' },
  { id: 'compact', label: 'Compact', note: '36px controls — good for long queues' },
  { id: 'minimal', label: 'Minimal', note: '32px controls, tightest rows' },
] as const;

export const MODES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
] as const;

export type Accent = (typeof ACCENTS)[number]['id'];
export type Density = (typeof DENSITIES)[number]['id'];
export type Mode = (typeof MODES)[number]['id'];

export type Appearance = { mode: Mode; accent: Accent; density: Density };

export const DEFAULT_APPEARANCE: Appearance = {
  mode: 'system',
  accent: 'sage',
  density: 'default',
};

export const APPEARANCE_STORAGE_KEY = 'dts.appearance';

export function isAccent(v: unknown): v is Accent {
  return ACCENTS.some((a) => a.id === v);
}
export function isDensity(v: unknown): v is Density {
  return DENSITIES.some((d) => d.id === v);
}
export function isMode(v: unknown): v is Mode {
  return MODES.some((m) => m.id === v);
}

/*
 * The boot script, inlined into <head> by the layout so it runs BEFORE first paint.
 *
 * Without it the server renders the default theme and React corrects it on hydrate, which the user
 * sees as a flash — white for anyone on dark, and the wrong accent for everyone else. A blocking
 * script is unavoidable here: the choice lives in localStorage, which the server cannot read, and
 * any approach that waits for React has already painted.
 *
 * It is a string so it can go straight into `dangerouslySetInnerHTML`. It reads one key of our own,
 * writes nothing, and swallows its own errors — `localStorage` throws outright in a locked-down
 * Safari private window, and a theme preference is not worth a white screen.
 *
 * Note it sets the attributes but does NOT validate them; the provider does that on mount. Worst
 * case a junk stored value matches no `[data-accent]` rule for a few milliseconds and the page
 * paints with the default palette, which is the same thing it would do with no attribute at all.
 */
export const appearanceBootScript = `(function(){try{
var s=localStorage.getItem('${APPEARANCE_STORAGE_KEY}');var a=s?JSON.parse(s):null;var r=document.documentElement;
var mode=(a&&a.mode)||'${DEFAULT_APPEARANCE.mode}';
r.dataset.accent=(a&&a.accent)||'${DEFAULT_APPEARANCE.accent}';
r.dataset.density=(a&&a.density)||'${DEFAULT_APPEARANCE.density}';
if(mode==='system'){r.removeAttribute('data-theme');}else{r.dataset.theme=mode;}
}catch(e){}})();`;
