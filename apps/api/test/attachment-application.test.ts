import { describe, expect, it } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { CreateDocumentInput } from '@dts/contracts';
import {
  DtsApplicationService,
  MAX_ATTACHMENT_BYTES,
} from '../src/modules/application/dts-application.service.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const outgoingInput = (overrides: Partial<CreateDocumentInput> = {}): CreateDocumentInput => ({
  title: 'Outgoing memorandum',
  type: 'MEMORANDUM',
  priority: 'NORMAL',
  direction: 'OUTGOING',
  divisionId: 'division-records',
  sectionId: 'section-intake',
  confidential: false,
  ...overrides,
});

const setup = () => {
  const service = new DtsApplicationService();
  const records = service.authenticate('records@dts.local', 'Records@1234!');
  const document = service.createDocument(records, outgoingInput());
  return { service, records, document };
};

// Captures the rejection of a promise so its type/payload can be asserted; fails loudly if
// the promise unexpectedly resolves.
const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to reject but it resolved');
};

describe('DtsApplicationService attachment logic', () => {
  it('rejects an empty upload', async () => {
    const { service, records, document } = setup();
    const error = await rejection(
      service.uploadAttachment(records, document.id, {
        buffer: Buffer.alloc(0),
        originalName: 'empty.pdf',
      }),
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'EMPTY_FILE' });
  });

  it('rejects an upload that exceeds the size limit before inspecting its bytes', async () => {
    const { service, records, document } = setup();
    const error = await rejection(
      service.uploadAttachment(records, document.id, {
        buffer: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1),
        originalName: 'too-big.pdf',
      }),
    );
    expect(error).toBeInstanceOf(PayloadTooLargeException);
    expect((error as PayloadTooLargeException).getResponse()).toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
  });

  it('rejects bytes that do not match an allowed media type', async () => {
    const { service, records, document } = setup();
    const error = await rejection(
      service.uploadAttachment(records, document.id, {
        buffer: Buffer.from('plain text masquerading as a pdf'),
        originalName: 'spoof.pdf',
      }),
    );
    expect(error).toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('quarantines on upload and only serves the bytes after a clean scan', async () => {
    const { service, records, document } = setup();
    const version = await service.uploadAttachment(records, document.id, {
      buffer: PDF,
      originalName: 'plan.pdf',
    });
    expect(version).toMatchObject({
      versionNumber: 1,
      mediaType: 'application/pdf',
      scanStatus: 'PENDING',
      isCurrent: true,
    });

    const beforeScan = service.getDocument(records, document.id);
    expect(beforeScan.hasCleanCurrentAttachment).toBe(false);
    expect(beforeScan.currentAttachmentVersionId).toBe(version.id);
    // Fail-closed: bytes cannot leave quarantine before a clean scan.
    expect(() => service.downloadAttachment(records, document.id, version.id)).toThrow(
      ConflictException,
    );

    const scanned = service.recordAttachmentScan(records, document.id, version.id, 'CLEAN');
    expect(scanned.scanStatus).toBe('CLEAN');

    // The clean scan flips the document flag the outgoing-release invariant reads.
    const afterScan = service.getDocument(records, document.id);
    expect(afterScan.hasCleanCurrentAttachment).toBe(true);

    const downloaded = service.downloadAttachment(records, document.id, version.id);
    expect(Buffer.from(downloaded.bytes).equals(PDF)).toBe(true);
    expect(downloaded.mediaType).toBe('application/pdf');
  });

  it('does not resolve a version through a document it does not belong to', async () => {
    const { service, records, document } = setup();
    const other = service.createDocument(records, outgoingInput());
    const version = await service.uploadAttachment(records, document.id, {
      buffer: PDF,
      originalName: 'plan.pdf',
    });
    expect(() => service.downloadAttachment(records, other.id, version.id)).toThrow(
      NotFoundException,
    );
  });

  it('refuses to record a scan result without the scan capability', async () => {
    const { service, document } = setup();
    const staff = service.authenticate('staff@dts.local', 'Staff@12345!');
    // Staff can create/edit within scope, so they can upload...
    const staffDocument = service.createDocument(
      staff,
      outgoingInput({ divisionId: 'division-pilot', sectionId: 'section-pilot' }),
    );
    const version = await service.uploadAttachment(staff, staffDocument.id, {
      buffer: PDF,
      originalName: 'plan.pdf',
    });
    // ...but they lack FILE_SCAN_RECORD, so confirming a scan is forbidden.
    expect(() =>
      service.recordAttachmentScan(staff, staffDocument.id, version.id, 'CLEAN'),
    ).toThrow(/not allowed/);
    // Cross-division isolation still holds: staff cannot even see the records-owned document.
    expect(() => service.getDocument(staff, document.id)).toThrow(NotFoundException);
  });
});
