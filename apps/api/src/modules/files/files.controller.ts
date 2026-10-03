import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { recordScanSchema, type RecordScanInput } from '@dts/contracts';
import { AuthGuard } from '../../common/auth.guard.js';
import { INLINE_CONTENT_CSP } from '../../common/inline-content.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AttachmentsService, MAX_ATTACHMENT_BYTES } from './attachments.service.js';

// The subset of multer's in-memory file object this controller consumes. Declared locally
// rather than relying on the `Express.Multer.File` ambient global, which does not resolve
// reliably under NodeNext module resolution and is used nowhere else in the codebase.
interface UploadedAttachment {
  buffer: Buffer;
  originalname: string;
}

// The original filename is untrusted input. It is preserved verbatim in the JSON metadata,
// but for the Content-Disposition header it is reduced to an ASCII-safe token so it cannot
// inject header characters (CR/LF/quotes) or smuggle path separators.
const safeDispositionFilename = (name: string): string => {
  const token = name
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return token.length > 0 ? token : 'attachment';
};

@Controller('documents/:documentId/attachments')
@UseGuards(AuthGuard)
export class FilesController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  // Memory storage (multer's default) exposes file.buffer; the fileSize limit rejects
  // oversized uploads at the edge before they are fully buffered into memory.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  async upload(
    @CurrentUser() actor: RequestUser,
    @Param('documentId') documentId: string,
    @UploadedFile() file: UploadedAttachment | undefined,
    @Body('attachmentId') attachmentId?: string,
  ) {
    if (file === undefined)
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'A file upload is required under the "file" field',
      });
    return {
      data: await this.attachments.upload(
        actor,
        documentId,
        { buffer: file.buffer, originalName: file.originalname },
        attachmentId,
      ),
    };
  }

  @Get()
  async list(@CurrentUser() actor: RequestUser, @Param('documentId') documentId: string) {
    return { data: await this.attachments.list(actor, documentId) };
  }

  @Get(':versionId/download')
  async download(
    @CurrentUser() actor: RequestUser,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.attachments.download(actor, documentId, versionId);
    response.setHeader('Content-Type', file.mediaType);
    // Never let the browser second-guess the validated type; force download disposition.
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeDispositionFilename(file.fileName)}"`,
    );
    response.send(Buffer.from(file.bytes));
  }

  /**
   * The same bytes with an `inline` disposition, for the in-page preview.
   *
   * A separate route rather than `?inline=1` on the download: the two have different response
   * headers, different allowed media types and different audit actions, and a query flag that
   * silently changes all three is the kind of thing that gets reviewed as if it changed nothing.
   */
  @Get(':versionId/content')
  async content(
    @CurrentUser() actor: RequestUser,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.attachments.preview(actor, documentId, versionId);
    response.setHeader('Content-Type', file.mediaType);
    // The media type was established by sniffing the bytes on upload. Never let the browser
    // re-guess it: a sniffed `text/html` would be rendered as a page, inline, from our own host.
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', INLINE_CONTENT_CSP);
    // The filename still travels, so a reader who chooses "save" from the viewer gets the real
    // name rather than the version UUID from the URL.
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${safeDispositionFilename(file.fileName)}"`,
    );
    // Private, and short: scope can be revoked, and a shared cache must never hand these bytes
    // to the next caller who asks for the same URL.
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(Buffer.from(file.bytes));
  }

  @Post(':versionId/scan')
  async scan(
    @CurrentUser() actor: RequestUser,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(recordScanSchema)) input: RecordScanInput,
  ) {
    return {
      data: await this.attachments.recordScan(actor, documentId, versionId, input.status),
    };
  }
}
