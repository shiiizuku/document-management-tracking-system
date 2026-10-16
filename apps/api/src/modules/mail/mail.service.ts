import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MailMessage, SkipMailInput, UpdateMailDraftInput } from '@dts/contracts';
import type { RequestUser } from '../../common/request-user.js';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import type { DatabaseExecutor } from '../../database/executor.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { OutboxWriter } from '../audit/outbox.writer.js';
import { AuthorizationPolicy } from '../authorization/authorization.policy.js';
import { DocumentsRepository, type DocumentRow } from '../documents/documents.repository.js';
import { FileVersionsRepository } from '../files/file-versions.repository.js';
import { resolveMailRecipients } from './mail-recipients.js';
import { MailRepository, type MailMessageRow } from './mail.repository.js';

/**
 * The body every draft starts with. Plain text; the releaser edits it in the Compose dialog. An
 * office-editable template is deferred (design, Open items), and this wording still needs the
 * office's sign-off before the pilot.
 */
export const DEFAULT_MAIL_BODY = [
  'Good day.',
  '',
  'Please find attached the signed copy of the document referenced in the subject.',
  '',
  'This message was sent from the document tracking system. Kindly reply to this email if you',
  'have questions about the document.',
].join('\n');

/** The `To`/`Cc`/`Bcc` cap in `mailAddressListSchema`; a draft never starts above it. */
const MAIL_ADDRESS_LIMIT = 20;

const MAIL_SEND_EVENT = 'mail.send';

/**
 * Release mail: the draft written when an outgoing document is prepared for release, and the
 * compose, send, resend and skip use cases behind `documents/:id/mail`.
 *
 * Depends on {@link DocumentsRepository}, never on `DocumentsService`: the documents service calls
 * {@link createDraft} inside its own release transaction, and a dependency the other way would be
 * a DI cycle. The read check is therefore the repository's `findReadableById`, the same SQL scope
 * `DocumentsService.getDocument` resolves through, so an unreadable document — confidential or out
 * of scope — answers the same 404 as one that does not exist.
 */
@Injectable()
export class MailService {
  private readonly authorization = new AuthorizationPolicy();

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly mail: MailRepository,
    private readonly documents: DocumentsRepository,
    private readonly fileVersions: FileVersionsRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly config: ConfigService,
  ) {}

  /**
   * Drafts the document's release email, or returns the draft it already has. `null` when the
   * document has no signed file version to attach: there is nothing to send, and the screen says
   * why. Runs on the caller's transaction so the draft and its audit row commit with the release.
   */
  async createDraft(
    documentId: string,
    actorId: string,
    tx: DatabaseExecutor,
  ): Promise<MailMessage | null> {
    const document = await this.documents.findById(documentId, tx);
    if (document === null) return null;
    const signatures = await this.documents.listSignatures(documentId, tx);
    const signed = signatures.at(-1);
    if (signed === undefined) return null;

    const to = resolveMailRecipients({
      recipients: document.recipients,
      requesterEmails: await this.documents.listLinkedRequesterEmails(documentId, tx),
    }).slice(0, MAIL_ADDRESS_LIMIT);

    const inserted = await this.mail.insertDraft(
      {
        documentId,
        fileVersionId: signed.fileVersionId,
        toAddresses: to,
        ccAddresses: [],
        bccAddresses: [],
        subject: this.subjectFor(document),
        body: DEFAULT_MAIL_BODY,
        createdById: actorId,
      },
      tx,
    );
    if (inserted === null) {
      const existing = await this.mail.findDraft(documentId, tx);
      return existing === null ? null : this.toPublic(existing);
    }
    await this.audit.write(
      {
        actorId,
        action: 'mail.drafted',
        targetType: 'document',
        targetId: documentId,
        outcome: 'SUCCESS',
        summary: { recipients: inserted.toAddresses.length },
      },
      tx,
    );
    return this.toPublic(inserted);
  }

  async list(actor: RequestUser, documentId: string): Promise<MailMessage[]> {
    await this.requireReleasable(actor, documentId);
    const rows = await this.mail.listForDocument(documentId);
    const names = new Map<string, string>();
    const result: MailMessage[] = [];
    for (const row of rows) {
      const name = names.get(row.fileVersionId) ?? (await this.attachmentName(row.fileVersionId));
      names.set(row.fileVersionId, name);
      result.push(this.present(row, name));
    }
    return result;
  }

  async update(
    actor: RequestUser,
    documentId: string,
    mailId: string,
    input: UpdateMailDraftInput,
  ): Promise<MailMessage> {
    await this.requireReleasable(actor, documentId);
    const current = await this.requireMessage(documentId, mailId);
    if (current.status !== 'DRAFT') throw this.notDraft();
    const updated = await this.mail.updateDraft(mailId, {
      toAddresses: input.to,
      ccAddresses: input.cc,
      bccAddresses: input.bcc,
      subject: input.subject,
      body: input.body,
    });
    // Sent by someone else between the read and the write.
    if (updated === null) throw this.notDraft();
    return this.toPublic(updated);
  }

  /**
   * Queues the draft for the worker. A message already queued or sent is returned as it is, so a
   * double-clicked Send is a quiet success; the outbox key `mail.send:<mailId>` makes the event
   * itself idempotent too.
   */
  async send(actor: RequestUser, documentId: string, mailId: string): Promise<MailMessage> {
    await this.requireReleasable(actor, documentId);
    this.requireConfigured();
    const current = await this.requireMessage(documentId, mailId);
    if (current.status === 'QUEUED' || current.status === 'SENT') return this.toPublic(current);
    if (current.status !== 'DRAFT')
      throw new ConflictException({
        code: 'MAIL_NOT_DRAFT',
        message: 'This message has already been sent; resend it instead',
      });
    if (current.toAddresses.length === 0)
      throw new UnprocessableEntityException({
        code: 'MAIL_NO_RECIPIENTS',
        message: 'Add at least one To address before sending',
      });

    const queued = await this.database.transaction(async (tx) => {
      const row = await this.mail.markQueued(mailId, actor.id, tx);
      if (row === null) return null;
      await this.enqueueSend(row, tx);
      return row;
    });
    if (queued !== null) return this.toPublic(queued);
    // Lost a race with another Send: report whatever the row is now.
    return this.toPublic(await this.requireMessage(documentId, mailId));
  }

  /** Copies a sent or failed message into a new queued row; the original is never rewritten. */
  async resend(actor: RequestUser, documentId: string, mailId: string): Promise<MailMessage> {
    await this.requireReleasable(actor, documentId);
    this.requireConfigured();
    const source = await this.requireMessage(documentId, mailId);
    if (source.status !== 'SENT' && source.status !== 'FAILED')
      throw new ConflictException({
        code: 'MAIL_NOT_RESENDABLE',
        message: 'Only a sent or failed message can be resent',
      });

    const copy = await this.database.transaction(async (tx) => {
      const row = await this.mail.insertQueued(
        {
          documentId,
          fileVersionId: source.fileVersionId,
          toAddresses: source.toAddresses,
          ccAddresses: source.ccAddresses,
          bccAddresses: source.bccAddresses,
          subject: source.subject,
          body: source.body,
          createdById: actor.id,
          sentById: actor.id,
        },
        tx,
      );
      await this.enqueueSend(row, tx);
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'mail.resent',
          targetType: 'document',
          targetId: documentId,
          outcome: 'SUCCESS',
          summary: { recipients: row.toAddresses.length, sourceMailId: source.id },
        },
        tx,
      );
      return row;
    });
    return this.toPublic(copy);
  }

  /**
   * Records that the document's draft will not be sent, with the releaser's reason. The release
   * guard reads it through {@link hasSkipped}. The audit row carries the remark's length only.
   */
  async skip(actor: RequestUser, documentId: string, input: SkipMailInput): Promise<void> {
    await this.requireReleasable(actor, documentId);
    await this.database.transaction(async (tx) => {
      const row = await this.mail.markSkipped(documentId, input.remarks, tx);
      if (row === null)
        throw new UnprocessableEntityException({
          code: 'MAIL_NOTHING_TO_SKIP',
          message: 'This document has no draft email to skip',
        });
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'mail.skipped',
          targetType: 'document',
          targetId: documentId,
          outcome: 'SUCCESS',
          summary: { remarksLength: input.remarks.length },
        },
        tx,
      );
    });
  }

  hasSent(documentId: string): Promise<boolean> {
    return this.mail.hasStatus(documentId, 'SENT');
  }

  hasSkipped(documentId: string): Promise<boolean> {
    return this.mail.hasSkipped(documentId);
  }

  // ------------------------------------------------------------------- internals

  /**
   * Read access first, then `DOCUMENT_RELEASE`. The order matters: a reader who cannot see the
   * document must get the 404 a missing id gets, never a 403 that confirms it exists.
   */
  private async requireReleasable(actor: RequestUser, documentId: string): Promise<DocumentRow> {
    const row = await this.documents.findReadableById(actor, documentId);
    if (row === null) throw new NotFoundException('Document not found');
    const facts = (await this.documents.authorizationFacts([documentId])).get(documentId) ?? {
      routes: [],
      assigneeUserIds: [],
      sharedUserIds: [],
    };
    const resource = {
      id: row.id,
      divisionId: row.divisionId,
      sectionId: row.sectionId,
      routes: facts.routes,
      assigneeUserIds: facts.assigneeUserIds,
      sharedUserIds: facts.sharedUserIds,
      confidential: row.confidential,
    };
    if (!this.authorization.can(actor, resource, 'DOCUMENT_RELEASE'))
      throw new ForbiddenException('Action is not allowed');
    return row;
  }

  private async requireMessage(documentId: string, mailId: string): Promise<MailMessageRow> {
    const row = await this.mail.findForDocument(documentId, mailId);
    if (row === null) throw new NotFoundException('Mail message not found');
    return row;
  }

  private requireConfigured(): void {
    if (this.config.get<string>('SMTP_HOST') === undefined)
      throw new UnprocessableEntityException({
        code: 'MAIL_NOT_CONFIGURED',
        message: 'Outgoing mail is not configured on this server',
      });
  }

  private enqueueSend(row: MailMessageRow, tx: DatabaseExecutor): Promise<void> {
    return this.outbox.enqueue(
      {
        aggregateType: 'mail_message',
        aggregateId: row.id,
        eventType: MAIL_SEND_EVENT,
        payload: { mailId: row.id, documentId: row.documentId },
        idempotencyKey: `${MAIL_SEND_EVENT}:${row.id}`,
      },
      tx,
    );
  }

  private notDraft(): ConflictException {
    return new ConflictException({
      code: 'MAIL_NOT_DRAFT',
      message: 'Only a draft can be edited',
    });
  }

  private subjectFor(document: DocumentRow): string {
    // Outgoing documents are allocated a reference at registration; the tracking number covers a
    // row that somehow has none rather than printing "null".
    return `${document.referenceNumber ?? document.trackingNumber}: ${document.title}`;
  }

  private async attachmentName(fileVersionId: string): Promise<string> {
    const version = await this.fileVersions.findVersionById(fileVersionId);
    return version?.originalName ?? 'document.pdf';
  }

  private async toPublic(row: MailMessageRow): Promise<MailMessage> {
    return this.present(row, await this.attachmentName(row.fileVersionId));
  }

  private present(row: MailMessageRow, attachmentName: string): MailMessage {
    return {
      id: row.id,
      documentId: row.documentId,
      to: row.toAddresses,
      cc: row.ccAddresses,
      bcc: row.bccAddresses,
      subject: row.subject,
      body: row.body,
      attachmentName,
      status: row.status,
      attempts: row.attempts,
      lastError: row.lastError,
      sentAt: row.sentAt?.toISOString() ?? null,
      skippedAt: row.skippedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
