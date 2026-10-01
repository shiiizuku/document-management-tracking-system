import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestAccountForm } from '../src/features/admin/request-account-form';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { calledPaths, calledWith, requestBody } from './mock-api';
import { renderWithQuery } from './query-harness';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

const fillValidly = async () => {
  await userEvent.type(screen.getByLabelText('Full name'), 'Jose Rizal');
  await userEvent.type(screen.getByLabelText('Work email'), 'jose@dts.local');
  await userEvent.type(screen.getByLabelText('Choose a password'), 'Noli-Me-Tangere99!');
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('RequestAccountForm', () => {
  it('submits the application the API expects', async () => {
    apiMock.mockResolvedValue({ submitted: true });
    renderWithQuery(<RequestAccountForm />);

    await fillValidly();
    await userEvent.type(
      screen.getByLabelText('Why do you need access?'),
      'Records intake for Legal.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => expect(calledWith(apiMock, 'POST', '/account-requests')).toBe(true));
    expect(requestBody(apiMock, '/account-requests', 'POST')).toEqual({
      displayName: 'Jose Rizal',
      email: 'jose@dts.local',
      password: 'Noli-Me-Tangere99!',
      justification: 'Records intake for Legal.',
    });
  });

  // Enforced here by `strongPasswordSchema` itself, so the rule cannot drift from the API's.
  it('states the password rule rather than letting the server refuse it', async () => {
    apiMock.mockResolvedValue({ submitted: true });
    renderWithQuery(<RequestAccountForm />);

    await userEvent.type(screen.getByLabelText('Full name'), 'Jose Rizal');
    await userEvent.type(screen.getByLabelText('Work email'), 'jose@dts.local');
    await userEvent.type(screen.getByLabelText('Choose a password'), 'alllowercase123');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(
      await screen.findByText('Password must contain an uppercase letter'),
    ).toBeInTheDocument();
    expect(calledPaths(apiMock)).toHaveLength(0);
  });

  it('rejects an address that is not an email, before asking the server', async () => {
    apiMock.mockResolvedValue({ submitted: true });
    renderWithQuery(<RequestAccountForm />);

    await userEvent.type(screen.getByLabelText('Full name'), 'Jose Rizal');
    await userEvent.type(screen.getByLabelText('Work email'), 'not-an-address');
    await userEvent.type(screen.getByLabelText('Choose a password'), 'Noli-Me-Tangere99!');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => expect(calledPaths(apiMock)).toHaveLength(0));
  });

  it('confirms the request and offers the way back to sign in', async () => {
    apiMock.mockResolvedValue({ submitted: true });
    renderWithQuery(<RequestAccountForm />);

    await fillValidly();
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(await screen.findByText('Your request has been received')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
    // The form held a password; it is not left on screen after a successful submission.
    expect(screen.queryByLabelText('Choose a password')).not.toBeInTheDocument();
  });

  // The API is deliberately rate-limited rather than informative here, so the form has to show
  // what it is told without inventing a reason.
  it('reports a refusal instead of claiming success', async () => {
    apiMock.mockRejectedValue(
      new ApiError({ status: 429, code: 'TOO_MANY_REQUESTS', message: 'Too many requests' }),
    );
    renderWithQuery(<RequestAccountForm />);

    await fillValidly();
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(await screen.findByText('Too many requests')).toBeInTheDocument();
    expect(screen.queryByText('Your request has been received')).not.toBeInTheDocument();
  });

  // `GET /divisions` needs a session, and the office's structure is not public. The applicant says
  // where they work in their own words instead.
  it('asks for no division list, so a public page discloses no structure', async () => {
    apiMock.mockResolvedValue({ submitted: true });
    renderWithQuery(<RequestAccountForm />);

    await waitFor(() => expect(screen.getByLabelText('Full name')).toBeInTheDocument());
    expect(calledPaths(apiMock)).toHaveLength(0);
    expect(screen.queryByLabelText('Division')).not.toBeInTheDocument();
  });
});
