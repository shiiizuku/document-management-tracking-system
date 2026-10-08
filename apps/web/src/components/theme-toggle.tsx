'use client';

import { useState } from 'react';
import { Moon, Palette, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { THEMES, THEME_NAMES, useTheme, type Theme } from './theme-provider';

/*
 * Each swatch previews its theme, not the current one, so it cannot read the CSS variables (those
 * are whatever theme is applied right now). These are the handoff's `accent` and `bar` values,
 * copied from the theme blocks in `app/theme.css`; change one there and change it here.
 */
const SWATCHES: Record<Theme, { accent: string; bar: string }> = {
  neutral: { accent: '#5C7A6B', bar: '#E6E1D8' },
  sage: { accent: '#4F7A64', bar: '#DCE6DF' },
  blush: { accent: '#8A5E66', bar: '#EADFE0' },
  civic: { accent: '#1F6B45', bar: '#13291F' },
};

/** Hover and open fills for an icon button that sits on the sidebar rather than on the page. */
const ON_SIDEBAR =
  'size-11 text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground';

/** Light / dark. Independent of the theme: every theme has both. */
export function ColorModeButton({
  tooltipSide = 'top',
  className,
}: Readonly<{ tooltipSide?: 'top' | 'right'; className?: string }>) {
  const { resolvedColorMode, setColorMode } = useTheme();
  const dark = resolvedColorMode === 'dark';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          className={cn(ON_SIDEBAR, className)}
          onClick={() => setColorMode(dark ? 'light' : 'dark')}
        >
          {dark ? <Moon /> : <Sun />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The theme picker: a palette button opening a grid of swatches with no visible names.
 *
 * Names are only accessible labels, on purpose. Four swatches in one row fit the sidebar footer;
 * four labelled rows did not, and the swatch already shows what a theme looks like better than its
 * name says it. Picking one applies it at once and closes the popover, and Radix returns focus to
 * the palette button on close, so a keyboard user ends where they started.
 */
export function ThemePicker({
  collapsed = false,
  className,
}: Readonly<{ collapsed?: boolean; className?: string }>) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Theme: ${THEME_NAMES[theme]}`}
          className={cn(ON_SIDEBAR, className)}
        >
          <Palette />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side={collapsed ? 'right' : 'top'}
        align="start"
        className="w-[216px] rounded-[14px] p-3 shadow-[0_12px_30px_rgb(0_0_0/0.18)]"
      >
        <p className="mb-2 text-[13px] font-semibold">Theme</p>
        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Themes">
          {THEMES.map((option) => {
            const selected = theme === option;
            return (
              <button
                key={option}
                type="button"
                aria-label={THEME_NAMES[option]}
                aria-pressed={selected}
                onClick={() => {
                  setTheme(option);
                  setOpen(false);
                }}
                className={cn(
                  'flex size-11 items-center justify-center rounded-[10px] outline-none',
                  'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                  selected && 'bg-muted shadow-[inset_0_0_0_1.5px_var(--primary)]',
                )}
              >
                <span
                  aria-hidden
                  className="size-[18px] rounded-full"
                  style={{
                    backgroundColor: SWATCHES[option].accent,
                    boxShadow: `0 0 0 3px ${SWATCHES[option].bar}`,
                  }}
                />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Both controls in a row, for the public pages, which have no sidebar to hold them. The shell
 * places the two separately in its footer.
 */
export function ThemeToggle() {
  return (
    <div className="flex items-center gap-1 text-muted-foreground">
      <ThemePicker className="text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground" />
      <ColorModeButton className="text-muted-foreground hover:bg-accent hover:text-foreground" />
    </div>
  );
}
