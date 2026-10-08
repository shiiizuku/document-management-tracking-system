import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DocumentPriority, WorkflowStatus } from '@dts/contracts';
import { PriorityLabel, StatusBadge } from '../src/components/dts/status-badge';

/*
 * Status has to read without colour (handoff, "Status signal"): every tone carries its own glyph,
 * and the glyph is decoration — the label is still the text a screen reader hears.
 */
const CASES: readonly [WorkflowStatus, string, string, string][] = [
  ['PENDING', 'wait', 'ring', 'En route'],
  ['FOR_REVISION', 'wait', 'ring', 'For revision'],
  ['FOR_INITIAL', 'wait', 'ring', 'For initial'],
  ['IN_PROCESS', 'move', 'dot', 'In process'],
  ['FOR_SIGNATURE', 'move', 'dot', 'For signature'],
  ['FOR_RELEASE', 'move', 'dot', 'For release'],
  ['SIGNED', 'done', 'check', 'Signed'],
  ['RELEASED', 'done', 'check', 'Released'],
  ['COMPLIED', 'done', 'check', 'Complied'],
  ['ARCHIVED', 'closed', 'dash', 'Archived'],
];

describe('StatusBadge', () => {
  it.each(CASES)('draws %s as a %s pill with a %s glyph', (status, tone, glyph, label) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText(label);

    expect(badge).toHaveAttribute('data-tone', tone);
    expect(badge).toHaveClass('rounded-full');
    const glyphs = badge.querySelectorAll('[data-glyph]');
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]).toHaveAttribute('data-glyph', glyph);
    expect(glyphs[0]).toHaveAttribute('aria-hidden');
    // The accessible text is the label alone.
    expect(badge).toHaveTextContent(new RegExp(`^${label}$`));
  });
});

describe('PriorityLabel', () => {
  it.each<[DocumentPriority, string]>([
    ['URGENT', 'Urgent'],
    ['HIGH', 'High'],
    ['NORMAL', 'Normal'],
    ['LOW', 'Low'],
  ])('writes %s in sentence case', (priority, label) => {
    render(<PriorityLabel priority={priority} />);
    expect(screen.getByText(label, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(priority)).not.toBeInTheDocument();
  });

  it('marks Urgent as a pill with a glyph, so it does not rely on red alone', () => {
    render(<PriorityLabel priority="URGENT" />);
    const pill = screen.getByText('Urgent', { exact: false });
    expect(pill).toHaveClass('rounded-full');
    expect(pill.querySelector('[aria-hidden]')).toHaveTextContent('!');
  });
});
