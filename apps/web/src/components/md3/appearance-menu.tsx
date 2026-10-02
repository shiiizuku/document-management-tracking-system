'use client';

import * as React from 'react';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  ACCENTS,
  DENSITIES,
  MODES,
  useAppearance,
  type Accent,
  type Density,
  type Mode,
} from './appearance';

const MODE_ICON = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * Accent swatch.
 *
 * The payoff of generating palettes from a hue: `data-accent` is a bare attribute selector in
 * md3-theme.css, not `:root[data-accent]`, so putting it on this span re-seeds the palette for this
 * span alone. The swatch then paints itself with ordinary `bg-primary` / `bg-secondary-container` /
 * `bg-tertiary` utilities and is a true preview — three real roles from the palette the user is
 * about to pick, in the mode they are currently in. No hardcoded hex list to drift out of sync with
 * the stylesheet.
 */
function Swatch({ accent, selected }: { accent: Accent; selected: boolean }) {
  return (
    <span
      data-accent={accent}
      aria-hidden
      className={cn(
        'flex size-5 shrink-0 overflow-hidden rounded-full ring-1 ring-outline-variant ring-inset',
        selected && 'ring-2 ring-primary',
      )}
    >
      <span className="h-full w-1/2 bg-primary" />
      <span className="h-full w-1/2 bg-tertiary" />
    </span>
  );
}

/**
 * The appearance picker: mode, accent, density.
 *
 * Built on the Radix dropdown the app already uses, which is what supplies the parts that are easy
 * to get wrong by hand — `role="menu"`, roving focus with arrow keys and Home/End, type-ahead,
 * Escape to dismiss, focus returned to the trigger on close, and `aria-checked` on the radio items.
 * The three groups are separate `RadioGroup`s so a screen reader announces "2 of 9" within the
 * accent list rather than within one 15-item menu.
 *
 * Changes apply on selection with no Save button: the whole point of a tonal system is that the
 * user can see the result, and a confirm step between the click and the repaint hides it.
 */
export function AppearanceMenu({ className }: { className?: string }) {
  const { mode, accent, density, set } = useAppearance();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/*
          `asChild` keeps the trigger's own button element, so it carries Radix's
          `aria-expanded` / `aria-haspopup` / `data-state` — and the MD3 state layer reads
          `[data-state='open']`, so the trigger stays lit while the menu is open.
        */}
        <Button
          variant="ghost"
          size="icon"
          className={className}
          /* The icon alone is not a name. Without this the control is announced as "button". */
          aria-label={`Appearance: ${mode} mode, ${accent} accent, ${density} density`}
        >
          <Palette />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-label-medium text-on-surface-variant">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => set({ mode: v as Mode })}>
          {MODES.map((m) => {
            const Icon = MODE_ICON[m.id];
            return (
              <DropdownMenuRadioItem key={m.id} value={m.id} className="gap-2">
                <Icon className="size-4 text-on-surface-variant" aria-hidden />
                {m.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-label-medium text-on-surface-variant">
          Accent
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={accent} onValueChange={(v) => set({ accent: v as Accent })}>
          {ACCENTS.map((a) => (
            <DropdownMenuRadioItem key={a.id} value={a.id} className="gap-2">
              <Swatch accent={a.id} selected={a.id === accent} />
              <span className="flex-1">{a.label}</span>
              {/*
                The swatch is `aria-hidden`, so the note is the only non-visual way to tell these
                apart — "Dusty pink" is what a screen-reader user hears instead of seeing the
                colour. It is not decoration.
              */}
              <span className="sr-only">{a.note}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-label-medium text-on-surface-variant">
          Density
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={density}
          onValueChange={(v) => set({ density: v as Density })}
        >
          {DENSITIES.map((d) => (
            <DropdownMenuRadioItem key={d.id} value={d.id} className="flex-col items-start gap-0">
              <span>{d.label}</span>
              <span className="text-label-small text-on-surface-variant">{d.note}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The same three choices as an inline panel, for a settings page — same state, no popover.
 *
 * Worth having as well as the menu: a nine-swatch grid you can compare side by side is a better
 * affordance for picking a colour than a nine-row list you scroll, and the density options read
 * better when their descriptions are visible rather than one-at-a-time.
 */
export function AppearancePanel() {
  const { mode, accent, density, set, reset } = useAppearance();

  return (
    <div className="flex flex-col gap-section">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-label-large text-on-surface-variant">Theme</legend>
        <div className="flex gap-2">
          {MODES.map((m) => {
            const Icon = MODE_ICON[m.id];
            return (
              <Button
                key={m.id}
                variant={mode === m.id ? 'secondary' : 'outline'}
                size="sm"
                /*
                 * `aria-pressed` rather than a bare button: these are toggles whose state is
                 * otherwise carried only by the fill, and fill alone is a colour-only signal —
                 * WCAG 1.4.1. The checkmark below does the same job visually.
                 */
                aria-pressed={mode === m.id}
                onClick={() => set({ mode: m.id })}
              >
                <Icon aria-hidden />
                {m.label}
                {mode === m.id && <Check aria-hidden />}
              </Button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-label-large text-on-surface-variant">Accent</legend>
        <div className="grid grid-cols-3 gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={accent === a.id}
              onClick={() => set({ accent: a.id })}
              className={cn(
                'md3-state-layer flex items-center gap-2 rounded-md3-md border p-2 text-left',
                'transition-[background-color,border-color] duration-(--md-duration-short-2) ease-standard',
                accent === a.id
                  ? 'border-primary bg-secondary-container text-on-secondary-container'
                  : 'border-outline-variant text-on-surface',
              )}
            >
              <Swatch accent={a.id} selected={accent === a.id} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-label-large">{a.label}</span>
                <span className="block truncate text-label-small text-on-surface-variant">
                  {a.note}
                </span>
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-label-large text-on-surface-variant">Density</legend>
        <div className="flex flex-col gap-2">
          {DENSITIES.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-pressed={density === d.id}
              onClick={() => set({ density: d.id })}
              className={cn(
                'md3-state-layer flex items-center justify-between gap-2 rounded-md3-md border px-3 py-2 text-left',
                'transition-[background-color,border-color] duration-(--md-duration-short-2) ease-standard',
                density === d.id
                  ? 'border-primary bg-secondary-container text-on-secondary-container'
                  : 'border-outline-variant text-on-surface',
              )}
            >
              <span>
                <span className="block text-label-large">{d.label}</span>
                <span className="block text-label-small text-on-surface-variant">{d.note}</span>
              </span>
              {density === d.id && <Check className="size-4 shrink-0" aria-hidden />}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <Button variant="ghost" size="sm" onClick={reset}>
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
