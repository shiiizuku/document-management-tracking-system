'use client';

import * as React from 'react';
import { Check, Moon, Palette, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ACCENTS, DENSITIES, useAppearance, type Accent } from './appearance';

/**
 * The accent preview dot.
 *
 * `data-accent` on the inner span re-seeds the palette for that span alone — the ramps in
 * md3-theme.css are declared for `:where(:root, [data-accent])`, so the derivation re-runs wherever
 * the attribute lands — and the two halves then paint themselves with ordinary `bg-primary` /
 * `bg-tertiary`. Two real roles from the palette on offer, in the mode the user is currently in,
 * with no hex list to drift out of step with the stylesheet.
 *
 * The ring stays OUTSIDE the re-seeded element on purpose. Inside it, `ring-primary` would resolve
 * from the palette being previewed — the selected dot would draw its ring in the very colour it is
 * sitting on, and the nine hairlines would each be a different hue instead of one quiet edge.
 */
function AccentDot({ accent, selected }: { accent: Accent; selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-5 shrink-0 overflow-hidden rounded-full transition-[box-shadow] duration-(--md-duration-short-2) ease-standard',
        selected
          ? 'ring-2 ring-primary ring-offset-2 ring-offset-popover'
          : 'ring-1 ring-outline-variant ring-inset',
      )}
    >
      <span data-accent={accent} className="flex h-full w-full">
        <span className="h-full w-1/2 bg-primary" />
        <span className="h-full w-1/2 bg-tertiary" />
      </span>
    </span>
  );
}

/**
 * The light/dark switch.
 *
 * A switch rather than the three-way radio the menu used, because two of those three choices are
 * what anyone actually reaches for and a binary control is quicker than opening a menu to reach
 * them. `system` is still honoured — it is the stored default and the OS keeps driving the page
 * until someone touches this — but once they do, the choice becomes explicit, which is the
 * ordinary meaning of flipping a switch labelled "Dark".
 *
 * `resolvedMode` is what it reflects, so while the mode is `system` the switch already shows what
 * the user is looking at rather than sitting in a third, unrepresented state.
 */
function ThemeSwitch() {
  const { resolvedMode, set } = useAppearance();
  const dark = resolvedMode === 'dark';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2">
          <Sun className="size-4 shrink-0 text-on-surface-variant" aria-hidden />
          <Switch
            checked={dark}
            onCheckedChange={(checked) => set({ mode: checked ? 'dark' : 'light' })}
            aria-label={dark ? 'Dark theme — switch to light' : 'Light theme — switch to dark'}
            icon={dark ? <Moon aria-hidden /> : <Sun aria-hidden />}
          />
          <Moon className="size-4 shrink-0 text-on-surface-variant" aria-hidden />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">{dark ? 'Dark theme' : 'Light theme'}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Accent and density, behind one palette button.
 *
 * The accents are icon-only with their name on hover, which is what lets nine of them sit in a
 * sidebar at all — nine labelled rows is a menu, nine dots is a palette. The name is not decorative:
 * `aria-label` carries it for a screen reader, the tooltip carries it for a pointer, and the
 * `note` ("Dusty pink") is what tells apart two dots a colour-blind user sees as the same.
 */
function PalettePopover({ collapsed }: { collapsed: boolean }) {
  const { accent, density, set, reset } = useAppearance();

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Appearance: ${accent} accent`}>
              <Palette />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={collapsed ? 'right' : 'top'}>Accent and density</TooltipContent>
      </Tooltip>

      <PopoverContent side={collapsed ? 'right' : 'top'} align="start" className="w-64">
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-label-medium text-on-surface-variant">Accent</legend>
          <div className="grid grid-cols-5 gap-2">
            {ACCENTS.map((a) => (
              <Tooltip key={a.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-pressed={accent === a.id}
                    aria-label={`${a.label} — ${a.note}`}
                    onClick={() => set({ accent: a.id })}
                    className="md3-state-layer flex items-center justify-center rounded-full p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <AccentDot accent={a.id} selected={accent === a.id} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {a.label}
                  <span className="block text-on-surface-variant/80">{a.note}</span>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4 flex flex-col gap-1">
          <legend className="pb-1 text-label-medium text-on-surface-variant">Density</legend>
          {DENSITIES.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-pressed={density === d.id}
              onClick={() => set({ density: d.id })}
              className={cn(
                'md3-state-layer flex items-center justify-between gap-2 rounded-md3-sm px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
                density === d.id ? 'text-on-surface' : 'text-on-surface-variant',
              )}
            >
              <span>
                <span className="block text-label-large">{d.label}</span>
                <span className="block text-label-small text-on-surface-variant">{d.note}</span>
              </span>
              {density === d.id && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
            </button>
          ))}
        </fieldset>

        <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={reset}>
          Reset to defaults
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The sidebar's appearance strip: theme on the left, palette on the right.
 *
 * It lives at the foot of the navigation rather than in the topbar because that is where a setting
 * belongs relative to the things you do — the topbar is for the current document's actions, and an
 * accent is not one. Collapsed, the switch gives way and only the palette button remains, which is
 * the one of the two that still works at 20px.
 */
export function AppearanceBar({ collapsed = false }: Readonly<{ collapsed?: boolean }>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-t border-border p-3',
        collapsed ? 'flex-col justify-center' : 'justify-between',
      )}
    >
      {collapsed ? null : <ThemeSwitch />}
      {collapsed ? <CollapsedThemeToggle /> : null}
      <PalettePopover collapsed={collapsed} />
    </div>
  );
}

/** The switch does not survive a 64px rail, so collapsed gets an icon button that does the same. */
function CollapsedThemeToggle() {
  const { resolvedMode, set } = useAppearance();
  const dark = resolvedMode === 'dark';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={dark ? 'Dark theme — switch to light' : 'Light theme — switch to dark'}
          onClick={() => set({ mode: dark ? 'light' : 'dark' })}
        >
          {dark ? <Moon /> : <Sun />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{dark ? 'Dark theme' : 'Light theme'}</TooltipContent>
    </Tooltip>
  );
}
