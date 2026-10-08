import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeadOfBureauCard } from '../src/features/org/head-of-bureau-card';
import type * as ApiModule from '../src/lib/api';
import { calledPaths, requestBody } from './mock-api';
import { renderWithQuery } from './query-harness';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const serve = () =>
  apiMock.mockImplementation((path: string, init?: { method?: string; body?: string }) => {
    if (path === '/office/head-of-bureau' && init?.method === 'PUT')
      return Promise.resolve(JSON.parse(init.body ?? '{}'));
    return Promise.resolve({ name: '', title: 'Regional Director' });
  });

afterEach(() => {
  vi.clearAllMocks();
});

describe('HeadOfBureauCard', () => {
  it('asks before changing who outgoing documents are sent by, then saves', async () => {
    serve();
    renderWithQuery(<HeadOfBureauCard />);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Regional Director'));

    await userEvent.type(screen.getByLabelText('Name'), 'Engr. Maria Santos');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // Nothing is written until the question is answered.
    const heading = await screen.findByRole('heading', { name: 'Change the Head of the Bureau?' });
    expect(calledPaths(apiMock).filter((path) => path === '/office/head-of-bureau')).toHaveLength(
      1,
    );
    const modal = heading.closest('[role="dialog"]') as HTMLElement;
    expect(within(modal).getByText('Engr. Maria Santos, Regional Director')).toBeInTheDocument();

    await userEvent.click(within(modal).getByRole('button', { name: 'Change' }));

    await waitFor(() =>
      expect(requestBody(apiMock, '/office/head-of-bureau', 'PUT')).toEqual({
        name: 'Engr. Maria Santos',
        title: 'Regional Director',
      }),
    );
  });

  it('writes nothing when the change is declined', async () => {
    serve();
    renderWithQuery(<HeadOfBureauCard />);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Regional Director'));

    await userEvent.type(screen.getByLabelText('Name'), 'Someone');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const heading = await screen.findByRole('heading', { name: 'Change the Head of the Bureau?' });
    await userEvent.click(
      within(heading.closest('[role="dialog"]') as HTMLElement).getByRole('button', {
        name: 'Cancel',
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Change the Head of the Bureau?' })).toBeNull(),
    );
    expect(requestBody(apiMock, '/office/head-of-bureau', 'PUT')).toEqual({});
  });
});
