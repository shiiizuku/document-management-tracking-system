'use client';

import { Moon, Palette, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ACCENTS, useTheme } from './theme-provider';

export function ThemeToggle({ collapsed = false }: Readonly<{ collapsed?: boolean }>) {
  const { resolvedTheme, setTheme, accent, setAccent } = useTheme();
  const dark = resolvedTheme === 'dark';
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <div
      className={
        collapsed
          ? 'flex flex-col items-center border-t p-2'
          : 'flex flex-col gap-2 border-t px-4 py-2'
      }
    >
      <div className={collapsed ? '' : 'flex items-center justify-between'}>
        {!collapsed && <span className="text-sm text-muted-foreground">Color mode</span>}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              onClick={() => setTheme(dark ? 'light' : 'dark')}
            >
              {dark ? <Moon /> : <Sun />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={collapsed ? 'right' : 'top'}>{label}</TooltipContent>
        </Tooltip>
      </div>
      <div className={collapsed ? '' : 'flex items-center justify-between gap-2'}>
        {!collapsed && <span className="text-sm text-muted-foreground">Accent color</span>}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Choose accent color: ${accent}`}>
              <Palette />
            </Button>
          </PopoverTrigger>
          <PopoverContent side={collapsed ? 'right' : 'top'} align="start" className="w-56">
            <p className="mb-3 text-sm font-medium">Accent color</p>
            <div className="flex flex-col gap-1" role="group" aria-label="Accent colors">
              {ACCENTS.map((option) => (
                <Button
                  key={option}
                  variant={accent === option ? 'secondary' : 'ghost'}
                  className="justify-start gap-3 capitalize"
                  aria-pressed={accent === option}
                  onClick={() => setAccent(option)}
                >
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-full border"
                    style={{
                      backgroundColor: {
                        default: '#71717a',
                        blue: '#3564ad',
                        green: '#28734d',
                        violet: '#7750ac',
                        rose: '#b44561',
                      }[option],
                    }}
                  />
                  {option}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
