'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { MAX_PROFILE_PHOTO_BYTES, PROFILE_PHOTO_TYPES, useUploadProfilePhoto } from './queries';

const MAX_MB = MAX_PROFILE_PHOTO_BYTES / (1024 * 1024);

/**
 * The signed-in user chooses their own profile photo.
 *
 * The type and size are checked here only to answer instantly; the server re-checks both, and
 * sniffs the bytes, so this is a convenience and not the control.
 */
export function ChangePhotoDialog({
  open,
  onOpenChange,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const uploadPhoto = useUploadProfilePhoto();

  const close = (next: boolean) => {
    if (!next) {
      setFile(null);
      setError(null);
    }
    onOpenChange(next);
  };

  const choose = (chosen: File | undefined) => {
    setError(null);
    if (chosen === undefined) {
      setFile(null);
    } else if (!(PROFILE_PHOTO_TYPES as readonly string[]).includes(chosen.type)) {
      setFile(null);
      setError('Choose a PNG, JPEG or WebP image.');
    } else if (chosen.size > MAX_PROFILE_PHOTO_BYTES) {
      setFile(null);
      setError(`That image is larger than ${String(MAX_MB)} MB.`);
    } else {
      setFile(chosen);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (file === null) return;
    uploadPhoto.mutate(file, {
      onSuccess: () => {
        close(false);
        toast.success('Profile photo updated');
      },
      onError: (failure) =>
        setError(
          failure instanceof ApiError ? failure.message : 'Could not upload the photo. Try again.',
        ),
    });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="eyebrow">Your account</p>
          <DialogTitle>Change photo</DialogTitle>
          <DialogDescription>
            PNG, JPEG or WebP, up to {MAX_MB} MB. It appears beside your name.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {error === null ? null : (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Could not use that photo</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
            <Label htmlFor="profile-photo">Photo</Label>
            <Input
              id="profile-photo"
              ref={input}
              type="file"
              accept={PROFILE_PHOTO_TYPES.join(',')}
              onChange={(event) => choose(event.target.files?.[0])}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={file === null || uploadPhoto.isPending}>
              {uploadPhoto.isPending ? <Loader2 className="animate-spin" /> : null}
              Upload photo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
