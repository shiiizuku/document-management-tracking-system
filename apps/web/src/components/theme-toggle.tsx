'use client';

import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTheme } from './theme-provider';

export function ThemeToggle({ collapsed = false }: Readonly<{ collapsed?: boolean }>) {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <div
      className={
        collapsed
          ? 'flex justify-center border-t p-2'
          : 'flex items-center justify-between border-t px-4 py-2'
      }
    >
      {!collapsed && <span className="text-sm text-muted-foreground">Appearance</span>}
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
  );
}
