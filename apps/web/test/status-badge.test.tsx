import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from '../src/components/status-badge';

describe('StatusBadge', () => {
  it('renders canonical source terminology instead of implementation enum names', () => {
    render(<StatusBadge status="FOR_SIGNATURE" />);
    expect(screen.getByText('For Signature')).toBeInTheDocument();
  });
});
