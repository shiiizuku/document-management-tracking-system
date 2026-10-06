# Shadcn UI appearance

Status: Shadcn is the sole design system. The Material 3 Expressive switch and stylesheet have been removed, superseding the former two-system plan.

Light mode uses subdued gray surfaces with brighter cards for hierarchy. Dark mode remains available independently of the accent choice.

The appearance controls offer Default (neutral), Blue, Green, Violet, and Rose accents. Accents apply to primary actions, focus rings, and interactive highlights; workflow status and destructive colors retain their semantic roles. The browser saves the accent under `dts.accent.v1` and applies it before first paint. Old design-system preferences no longer affect rendering.

Color changes and interactive surfaces transition gently. The main content enters with a short fade and small vertical movement. Reduced-motion preferences disable decorative motion. Appearance changes keep mounted forms and workflow state intact.
