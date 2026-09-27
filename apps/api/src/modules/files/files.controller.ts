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
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import {
  DtsApplicationService,
  MAX_ATTACHMENT_BYTES,
} from '../application/dts-application.service.js';

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
  constructor(private readonly application: DtsApplicationService) {}

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
      data: await this.application.uploadAttachment(
        actor,
        documentId,
        { buffer: file.buffer, originalName: file.originalname },
        attachmentId,
      ),
    };
  }

  @Get()
  list(@CurrentUser() actor: RequestUser, @Param('documentId') documentId: string) {
    return { data: this.application.listAttachments(actor, documentId) };
  }

  @Get(':versionId/download')
  download(
    @CurrentUser() actor: RequestUser,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
    @Res() response: Response,
  ): void {
    const file = this.application.downloadAttachment(actor, documentId, versionId);
    response.setHeader('Content-Type', file.mediaType);
    // Never let the browser second-guess the validated type; force download disposition.
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeDispositionFilename(file.fileName)}"`,
    );
    response.send(Buffer.from(file.bytes));
  }

  @Post(':versionId/scan')
  scan(
    @CurrentUser() actor: RequestUser,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(recordScanSchema)) input: RecordScanInput,
  ) {
    return {
      data: this.application.recordAttachmentScan(actor, documentId, versionId, input.status),
    };
  }
}
