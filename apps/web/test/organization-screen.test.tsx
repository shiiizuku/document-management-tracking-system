import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrganizationScreen } from '../src/features/org/organization-screen';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { DIVISION_ID, division, section } from './fixtures';
import { calledWith, requestBody } from './mock-api';
import { renderWithQuery } from './query-harness';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const serve = (
  options: {
    divisions?: ReturnType<typeof division>[] | Error;
    sections?: ReturnType<typeof section>[];
  } = {},
) => {
  const divisions = options.divisions ?? [division()];
  apiMock.mockImplementation((path: string) => {
    if (path === '/divisions')
      return divisions instanceof Error ? Promise.reject(divisions) : Promise.resolve(divisions);
    if (path.startsWith('/divisions/')) return Promise.resolve(division({ name: 'Renamed' }));
    if (path.startsWith('/sections?')) return Promise.resolve(options.sections ?? [section()]);
    if (path === '/sections') return Promise.resolve(section({ name: 'Releasing' }));
    if (path.startsWith('/sections/')) return Promise.resolve(section({ active: false }));
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('OrganizationScreen', () => {
  it('shows each division with its code and the sections nested under it', async () => {
    serve();
    renderWithQuery(<OrganizationScreen />);

    await waitFor(() => expect(screen.getByText('Records Division')).toBeInTheDocument());
    expect(screen.getByText('REC')).toBeInTheDocument();
    // The sections arrive in their own request per division, so they are waited for separately.
    await waitFor(() => expect(screen.getByText('Intake')).toBeInTheDocument());
    expect(screen.getByText('1 section')).toBeInTheDocument();
  });

  it('marks an inactive division rather than hiding it from the console', async () => {
    serve({ divisions: [division({ active: false })] });
    renderWithQuery(<OrganizationScreen />);

    await waitFor(() => expect(screen.getByText('Inactive')).toBeInTheDocument());
  });

  it('explains an empty organization', async () => {
    serve({ divisions: [] });
    renderWithQuery(<OrganizationScreen />);

    await waitFor(() => expect(screen.getByText('No divisions yet')).toBeInTheDocument());
  });

  it('reports a failed load rather than an empty organization', async () => {
    serve({
      divisions: new ApiError({ status: 500, code: 'HTTP_500', message: 'Tree unavailable' }),
    });
    renderWithQuery(<OrganizationScreen />);

    await waitFor(() => expect(screen.getByText('Tree unavailable')).toBeInTheDocument());
    expect(screen.queryByText('No divisions yet')).not.toBeInTheDocument();
  });

  // Codes are embedded in allocated reference numbers, so the API accepts a change to name and
  // active only. A field the server would reject is worse than no field.
  it('does not offer the code for editing', async () => {
    serve();
    renderWithQuery(<OrganizationScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument());

    await userEvent.click(screen.getAllByRole('button', { name: /Edit/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Code')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toBeInTheDocument();
  });

  it('offers deactivation instead of deletion, because documents reference the division', async () => {
    serve();
    renderWithQuery(<OrganizationScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: /Edit/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('Active'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(calledWith(apiMock, 'PATCH', `/divisions/${DIVISION_ID}`)).toBe(true),
    );
    expect(requestBody(apiMock, `/divisions/${DIVISION_ID}`)).toEqual({
      name: 'Records Division',
      active: false,
    });
  });

  it('upper-cases a typed code so the schema does not reject what a user naturally types', async () => {
    serve();
    renderWithQuery(<OrganizationScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add division' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add division' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Code'), 'leg');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Legal Division');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create division' }));

    await waitFor(() => expect(calledWith(apiMock, 'POST', '/divisions')).toBe(true));
    expect(requestBody(apiMock, '/divisions', 'POST')).toEqual({
      code: 'LEG',
      name: 'Legal Division',
    });
  });

  it('creates a section against the division it was opened from', async () => {
    serve();
    renderWithQuery(<OrganizationScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add section' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add section' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Code'), 'REL');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Releasing');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create section' }));

    await waitFor(() => expect(calledWith(apiMock, 'POST', '/sections')).toBe(true));
    expect(requestBody(apiMock, '/sections')).toEqual({
      divisionId: DIVISION_ID,
      code: 'REL',
      name: 'Releasing',
    });
  });

  it('rejects a code the schema will not accept, before asking the server', async () => {
    serve();
    renderWithQuery(<OrganizationScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add division' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add division' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Code'), 'A');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Legal Division');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create division' }));

    await waitFor(() => expect(calledWith(apiMock, 'POST', '/divisions')).toBe(false));
  });
});
