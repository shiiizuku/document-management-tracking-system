import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Capability } from '@dts/contracts';
import { RequireCapability } from '../src/features/session/require-capability';
import type * as ApiModule from '../src/lib/api';
import type { SessionUser } from '../src/features/session/queries';
import { renderWithQuery } from './query-harness';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const user = (capabilities: Capability[]): SessionUser => ({
  id: 'u1',
  email: 'staff@dts.local',
  displayName: 'Ana Dela Cruz',
  role: 'STAFF_MEMBER',
  divisionId: null,
  sectionId: null,
  capabilities,
  canAccessConfidential: false,
  active: true,
});

const renderGate = () =>
  renderWithQuery(
    <RequireCapability capability="REPORT_VIEW">
      <p>Monthly report</p>
    </RequireCapability>,
  );

afterEach(() => {
  vi.clearAllMocks();
});

describe('RequireCapability', () => {
  it('renders the screen for a user who holds the capability', async () => {
    apiMock.mockResolvedValue(user(['REPORT_VIEW']));
    renderGate();
    await waitFor(() => expect(screen.getByText('Monthly report')).toBeInTheDocument());
  });

  it('refuses a user who does not, without rendering the screen behind it', async () => {
    apiMock.mockResolvedValue(user([]));
    renderGate();
    await waitFor(() =>
      expect(screen.getByText('You do not have access to this area')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Monthly report')).not.toBeInTheDocument();
  });

  // Showing the refusal before the session resolves would tell a perfectly entitled user they
  // have no access, then correct itself a moment later.
  it('shows nothing at all while the session is still loading', () => {
    apiMock.mockReturnValue(new Promise(() => undefined));
    renderGate();
    expect(screen.queryByText('Monthly report')).not.toBeInTheDocument();
    expect(screen.queryByText('You do not have access to this area')).not.toBeInTheDocument();
  });
});
