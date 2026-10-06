'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ReleaseMethodCode } from '@dts/contracts';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { useRecordReleaseCarrier, useReleaseMethods, type DocumentDetail } from './queries';

/**
 * Fills in the carrier of a mailed release recorded before carriers were asked for (policy
 * register P-15 as decided 2026-10-06). Migration `0013` gave those releases no carrier rather
 * than inventing one, and Records staff complete the blank from the paper record.
 *
 * The tracking reference is optional here, unlike at release: these releases were made without
 * one, and demanding it would leave the carrier unrecordable. It is offered only for a carrier that
 * takes one, as the release dialog does.
 */
export function ReleaseCarrierDialog({ document }: Readonly<{ document: DocumentDetail }>) {
  const [open, setOpen] = useState(false);
  const [carrierCode, setCarrierCode] = useState<ReleaseMethodCode | null>(null);
  const [trackingReference, setTrackingReference] = useState('');
  const methods = useReleaseMethods(open);
  const record = useRecordReleaseCarrier(document.id);

  const carriers =
    methods.data?.find((method) => method.code === document.releaseMethod?.code)?.carriers ?? [];
  const selected = carriers.find((carrier) => carrier.code === carrierCode) ?? null;

  const close = () => {
    setOpen(false);
    setCarrierCode(null);
    setTrackingReference('');
  };

  const onSubmit = () => {
    if (selected === null) return;
    const reference = trackingReference.trim();
    record.mutate(
      {
        carrier: selected.code,
        ...(selected.requiresTrackingReference && reference.length > 0
          ? { trackingReference: reference }
          : {}),
      },
      {
        onSuccess: () => {
          close();
          toast.success('Carrier recorded', {
            description: `${document.trackingNumber} was sent by ${selected.label}.`,
          });
        },
        onError: (error) => {
          // A 409 means someone else recorded it first. The refetch shows their answer.
          if (error instanceof ApiError && error.isConflict) {
            close();
            toast.error('The carrier is already recorded', {
              description: 'Someone else recorded it while this was open. It is now shown.',
            });
            return;
          }
          toast.error('Could not record the carrier', {
            description: error instanceof Error ? error.message : 'Please try again.',
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button type="button" variant="link" size="sm" className="h-auto p-0">
          Record carrier
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader>
            <p className="eyebrow">Record carrier</p>
            <DialogTitle>{document.trackingNumber}</DialogTitle>
            <DialogDescription>
              This release was recorded as mailed before the carrier was asked for. Record how it
              was sent from the paper record. Once recorded, the carrier cannot be changed here.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="correct-carrier">Carrier</Label>
              <Select
                value={selected?.code ?? ''}
                disabled={carriers.length === 0}
                onValueChange={(value) => {
                  setCarrierCode(value);
                  setTrackingReference('');
                }}
              >
                <SelectTrigger id="correct-carrier">
                  <SelectValue
                    placeholder={methods.isPending ? 'Loading carriers…' : 'Choose a carrier'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {carriers.map((carrier) => (
                    <SelectItem key={carrier.code} value={carrier.code}>
                      {carrier.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selected?.requiresTrackingReference ? (
              <div className="space-y-1.5">
                <Label htmlFor="correct-tracking-reference">
                  {selected.label} tracking reference (optional)
                </Label>
                <Input
                  id="correct-tracking-reference"
                  maxLength={120}
                  value={trackingReference}
                  onChange={(event) => setTrackingReference(event.target.value)}
                />
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={record.isPending || selected === null}>
              {record.isPending ? <Loader2 className="animate-spin" /> : null}
              Record carrier
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
