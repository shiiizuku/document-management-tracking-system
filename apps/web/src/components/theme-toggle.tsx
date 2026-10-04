'use client';

import { Moon, Palette, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTheme } from './theme-provider';

export function ThemeToggle({ collapsed = false }: Readonly<{ collapsed?: boolean }>) {
  const { resolvedTheme, setTheme, designSystem, setDesignSystem } = useTheme();
  const dark = resolvedTheme === 'dark';
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  const systemLabel =
    designSystem === 'shadcn' ? 'Switch to Material 3 Expressive' : 'Switch to shadcn UI';
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
        {!collapsed && (
          <span className="text-sm text-muted-foreground">
            UI: <span className="shadcn-only">shadcn</span>
            <span className="md3-only">M3 Expressive</span>
          </span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={systemLabel}
              onClick={() => setDesignSystem(designSystem === 'shadcn' ? 'md3' : 'shadcn')}
            >
              <Palette />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={collapsed ? 'right' : 'top'}>{systemLabel}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
