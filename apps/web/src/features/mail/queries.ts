'use client';

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

/** The document's release emails, newest first as the screen sorts them. */
export function useMailMessages(documentId: string) {
  return useQuery({
    queryKey: mailKeys.list(documentId),
    queryFn: () => api<MailMessage[]>(basePath(documentId)),
  });
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

export function useSendMail(documentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (mailId: string) =>
      api<MailMessage>(`${basePath(documentId)}/${mailId}/send`, { method: 'POST' }),
    onSuccess: () => settle(client, documentId),
  });
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
