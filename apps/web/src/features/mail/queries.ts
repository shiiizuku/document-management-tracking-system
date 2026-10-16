'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { MailMessage, SkipMailInput, UpdateMailDraftInput } from '@dts/contracts';
import { invalidateDocument } from '@/features/documents/queries';
import { api } from '@/lib/api';

export type { MailMessage };

/** Private to this module, like the document keys: the hooks below are the only way in. */
const mailKeys = {
  list: (documentId: string) => ['mail', documentId] as const,
};

const basePath = (documentId: string) => `/documents/${documentId}/mail`;

/**
 * Every mail mutation settles both the mail list and the document: a send, a resend and a skip
 * each change what the release dialog will accept (`RELEASE_MAIL_REQUIRED`), and the document's
 * own payload is what the rest of the screen reads.
 */
const settle = (client: QueryClient, documentId: string): void => {
  void client.invalidateQueries({ queryKey: mailKeys.list(documentId) });
  invalidateDocument(client, documentId);
};

/** How often the list is re-read while the worker still has a message to deliver. */
const QUEUED_POLL_MS = 3000;

/**
 * The list's poll interval: every 3 s while any message is `QUEUED`, so the releaser sees it turn
 * Sent or Failed without a reload (the worker's result is not pushed to the page), else none.
 */
export const mailRefetchInterval = (
  messages: readonly MailMessage[] | undefined,
): number | false =>
  messages?.some((message) => message.status === 'QUEUED') === true ? QUEUED_POLL_MS : false;

/**
 * The document's release emails. Polls while one is queued; when a poll sees a status change —
 * the worker delivering or failing it — the document is refreshed too, because a sent mail is
 * what an Emailed release now accepts.
 */
export function useMailMessages(documentId: string) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: mailKeys.list(documentId),
    queryFn: () => api<MailMessage[]>(basePath(documentId)),
    refetchInterval: (current) => mailRefetchInterval(current.state.data),
  });
  const statuses = query.data?.map((message) => `${message.id}:${message.status}`).join(',');
  const seen = useRef(statuses);
  useEffect(() => {
    if (seen.current !== undefined && statuses !== undefined && seen.current !== statuses)
      invalidateDocument(client, documentId);
    seen.current = statuses;
  }, [client, documentId, statuses]);
  return query;
}

export function useUpdateMail(documentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ mailId, input }: { mailId: string; input: UpdateMailDraftInput }) =>
      api<MailMessage>(`${basePath(documentId)}/${mailId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => settle(client, documentId),
  });
}

/**
 * Sends a draft as the releaser last saw it: `revision` is the one their own save returned, and
 * the server answers `MAIL_CHANGED` when the stored draft has moved on since.
 */
export function useSendMail(documentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ mailId, revision }: { mailId: string; revision: string }) =>
      api<MailMessage>(`${basePath(documentId)}/${mailId}/send`, {
        method: 'POST',
        body: JSON.stringify({ revision }),
      }),
    onSuccess: () => settle(client, documentId),
  });
}

/**
 * Re-reads the document's messages and returns the stored copy of one, for a Compose dialog
 * whose Send was refused because the draft changed underneath it.
 */
export function useReloadMail(documentId: string) {
  const client = useQueryClient();
  return async (mailId: string): Promise<MailMessage | undefined> => {
    const messages = await client.fetchQuery({
      queryKey: mailKeys.list(documentId),
      queryFn: () => api<MailMessage[]>(basePath(documentId)),
      staleTime: 0,
    });
    return messages.find((message) => message.id === mailId);
  };
}

export function useResendMail(documentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (mailId: string) =>
      api<MailMessage>(`${basePath(documentId)}/${mailId}/resend`, { method: 'POST' }),
    onSuccess: () => settle(client, documentId),
  });
}

export function useSkipMail(documentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SkipMailInput) =>
      api<void>(`${basePath(documentId)}/skip`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => settle(client, documentId),
  });
}
