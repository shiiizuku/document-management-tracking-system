import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangePhotoDialog } from '../src/features/session/change-photo-dialog';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { renderWithQuery } from './query-harness';

const { uploadMock, toastSuccess } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, upload: uploadMock };
});

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const choose = (file: File) =>
  userEvent.upload(screen.getByLabelText('Photo'), file, { applyAccept: false });

afterEach(() => {
  vi.clearAllMocks();
});

describe('ChangePhotoDialog', () => {
  it('uploads the chosen image to the caller’s own photo, then closes', async () => {
    uploadMock.mockResolvedValue({ mediaType: 'image/png', sizeBytes: 3 });
    const onOpenChange = vi.fn();
    renderWithQuery(<ChangePhotoDialog open onOpenChange={onOpenChange} />);

    const file = new File([new Uint8Array([1, 2, 3])], 'me.png', { type: 'image/png' });
    await choose(file);
    await userEvent.click(screen.getByRole('button', { name: 'Upload photo' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [path, body] = uploadMock.mock.calls[0] as [string, FormData];
    expect(path).toBe('/me/photo');
    expect(body.get('file')).toBe(file);
    expect(toastSuccess).toHaveBeenCalledWith('Profile photo updated');
  });

  it('refuses a file that is not an accepted image, without asking the server', async () => {
    renderWithQuery(<ChangePhotoDialog open onOpenChange={vi.fn()} />);

    await choose(new File(['x'], 'notes.pdf', { type: 'application/pdf' }));

    expect(await screen.findByText('Choose a PNG, JPEG or WebP image.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeDisabled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('refuses an image over the size limit', async () => {
    renderWithQuery(<ChangePhotoDialog open onOpenChange={vi.fn()} />);

    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await choose(big);

    expect(await screen.findByText('That image is larger than 2 MB.')).toBeInTheDocument();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal and stays open', async () => {
    uploadMock.mockRejectedValue(
      new ApiError({
        status: 415,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Profile photos must be PNG, JPEG or WebP',
      }),
    );
    const onOpenChange = vi.fn();
    renderWithQuery(<ChangePhotoDialog open onOpenChange={onOpenChange} />);

    await choose(new File(['x'], 'fake.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: 'Upload photo' }));

    expect(await screen.findByText('Profile photos must be PNG, JPEG or WebP')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
