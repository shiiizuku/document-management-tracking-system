import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangePasswordDialog } from '../src/features/session/change-password-dialog';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { calledPaths, requestBody } from './mock-api';
import { renderWithQuery } from './query-harness';

const { apiMock, toastSuccess } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const CURRENT = 'Records@1234!';
const NEXT = 'Fresh-Passw0rd-2026';

const fill = async (
  dialog: HTMLElement,
  values: { current: string; next: string; confirm: string },
) => {
  await userEvent.type(within(dialog).getByLabelText('Current password'), values.current);
  await userEvent.type(within(dialog).getByLabelText('New password'), values.next);
  await userEvent.type(within(dialog).getByLabelText('Confirm new password'), values.confirm);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('ChangePasswordDialog', () => {
  it('sends the current and new password, then closes and says other sessions ended', async () => {
    apiMock.mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    renderWithQuery(<ChangePasswordDialog open onOpenChange={onOpenChange} />);

    await fill(screen.getByRole('dialog'), { current: CURRENT, next: NEXT, confirm: NEXT });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    // The confirmation is a client-side check only and never leaves the browser.
    expect(requestBody(apiMock, '/me/password', 'POST')).toEqual({
      currentPassword: CURRENT,
      newPassword: NEXT,
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'Password changed',
      expect.objectContaining({ description: expect.stringContaining('signed out') as string }),
    );
  });

  it('refuses a confirmation that does not match, without asking the server', async () => {
    renderWithQuery(<ChangePasswordDialog open onOpenChange={vi.fn()} />);

    await fill(screen.getByRole('dialog'), { current: CURRENT, next: NEXT, confirm: `${NEXT}x` });

    expect(await screen.findByText('The passwords do not match')).toBeVisible();
    expect(calledPaths(apiMock)).not.toContain('/me/password');
  });

  it('checks the password policy before asking the server', async () => {
    renderWithQuery(<ChangePasswordDialog open onOpenChange={vi.fn()} />);

    await fill(screen.getByRole('dialog'), { current: CURRENT, next: 'short', confirm: 'short' });

    expect(await screen.findByText('Password must be at least 12 characters')).toBeVisible();
    expect(calledPaths(apiMock)).not.toContain('/me/password');
  });

  it('puts a wrong current password on its own field and stays open', async () => {
    apiMock.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'The current password is incorrect',
        details: {
          formErrors: [],
          fieldErrors: { currentPassword: ['The current password is incorrect'] },
        },
      }),
    );
    const onOpenChange = vi.fn();
    renderWithQuery(<ChangePasswordDialog open onOpenChange={onOpenChange} />);

    await fill(screen.getByRole('dialog'), {
      current: 'Wrong-Passw0rd!',
      next: NEXT,
      confirm: NEXT,
    });

    const field = await screen.findByText('The current password is incorrect');
    expect(field).toBeVisible();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
