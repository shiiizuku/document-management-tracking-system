import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import {
  sendMailSchema,
  skipMailSchema,
  updateMailDraftSchema,
  type SendMailInput,
  type SkipMailInput,
  type UpdateMailDraftInput,
} from '@dts/contracts';
import { AuthGuard } from '../../common/auth.guard.js';
import { CsrfGuard } from '../../common/csrf.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { MailService } from './mail.service.js';

/*
 * Ids in the path are validated before they reach Postgres, where a malformed uuid would be a cast
 * error answered as a 500 rather than the 400 every other malformed request gets.
 */
const idPipe = () => new ZodValidationPipe(z.uuid());

/**
 * A document's release email. Every route needs `DOCUMENT_RELEASE` and read access to the
 * document; both are checked in {@link MailService}, read access first. The mutations (edit,
 * send, resend, skip) also need the session's CSRF header, which `CsrfGuard` skips for the GET.
 */
@Controller('documents/:id/mail')
@UseGuards(AuthGuard, CsrfGuard)
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get()
  list(@CurrentUser() actor: RequestUser, @Param('id', idPipe()) id: string) {
    return this.mail.list(actor, id).then((data) => ({ data }));
  }

  // Declared before the `:mailId` routes so the literal path is not captured as a message id.
  @Post('skip')
  @HttpCode(204)
  async skip(
    @CurrentUser() actor: RequestUser,
    @Param('id', idPipe()) id: string,
    @Body(new ZodValidationPipe(skipMailSchema)) input: SkipMailInput,
  ): Promise<void> {
    await this.mail.skip(actor, id, input);
  }

  @Patch(':mailId')
  update(
    @CurrentUser() actor: RequestUser,
    @Param('id', idPipe()) id: string,
    @Param('mailId', idPipe()) mailId: string,
    @Body(new ZodValidationPipe(updateMailDraftSchema)) input: UpdateMailDraftInput,
  ) {
    return this.mail.update(actor, id, mailId, input).then((data) => ({ data }));
  }

  @Post(':mailId/send')
  send(
    @CurrentUser() actor: RequestUser,
    @Param('id', idPipe()) id: string,
    @Param('mailId', idPipe()) mailId: string,
    @Body(new ZodValidationPipe(sendMailSchema)) input: SendMailInput,
  ) {
    return this.mail.send(actor, id, mailId, input).then((data) => ({ data }));
  }

  @Post(':mailId/resend')
  resend(
    @CurrentUser() actor: RequestUser,
    @Param('id', idPipe()) id: string,
    @Param('mailId', idPipe()) mailId: string,
  ) {
    return this.mail.resend(actor, id, mailId).then((data) => ({ data }));
  }
}
