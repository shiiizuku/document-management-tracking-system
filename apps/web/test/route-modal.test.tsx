import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteModal } from '../src/components/route-modal';
import type * as DocumentsModule from '../src/lib/documents';
import type * as OrganizationModule from '../src/lib/organization';

const { routeMock, divisionsMock, sectionsMock } = vi.hoisted(() => ({
  routeMock: vi.fn(),
  divisionsMock: vi.fn(),
  sectionsMock: vi.fn(),
}));

vi.mock('../src/lib/documents', async () => {
  const actual = await vi.importActual<typeof DocumentsModule>('../src/lib/documents');
  return { ...actual, routeDocument: routeMock };
});
vi.mock('../src/lib/organization', async () => {
  const actual = await vi.importActual<typeof OrganizationModule>('../src/lib/organization');
  return { ...actual, fetchDivisions: divisionsMock, fetchSections: sectionsMock };
});

const divisions = [
  { id: 'div-records', code: 'REC', name: 'Records Office', active: true },
  { id: 'div-pilot', code: 'PIL', name: 'Pilot Division', active: true },
];

afterEach(() => vi.clearAllMocks());

describe('RouteModal', () => {
  it('excludes the current division from the destinations', async () => {
    divisionsMock.mockResolvedValue(divisions);
    sectionsMock.mockResolvedValue([]);
    render(
      <RouteModal
        documentId="d1"
        expectedVersion={2}
        currentDivisionId="div-records"
        onClose={() => undefined}
        onRouted={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByText('Pilot Division')).toBeInTheDocument());
    expect(screen.queryByText('Records Office')).not.toBeInTheDocument();
  });

  it('forwards to the chosen division with the expected version', async () => {
    divisionsMock.mockResolvedValue(divisions);
    sectionsMock.mockResolvedValue([]);
    routeMock.mockResolvedValue({});
    const onRouted = vi.fn();
    render(
      <RouteModal
        documentId="d1"
        expectedVersion={2}
        currentDivisionId="div-records"
        onClose={() => undefined}
        onRouted={onRouted}
      />,
    );
    await waitFor(() => expect(screen.getByText('Pilot Division')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('To division'), 'div-pilot');
    await userEvent.click(screen.getByRole('button', { name: /forward document/i }));

    await waitFor(() => expect(routeMock).toHaveBeenCalled());
    expect(routeMock).toHaveBeenCalledWith('d1', { expectedVersion: 2, toDivisionId: 'div-pilot' });
    expect(onRouted).toHaveBeenCalled();
  });
});
