import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard } from '../../common/auth.guard.js';
import { CsrfGuard } from '../../common/csrf.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { IdentityService, MAX_PROFILE_PHOTO_BYTES } from './identity.service.js';

// The subset of multer's in-memory file object this controller consumes, declared locally for
// the same reason as in `files.controller.ts`: the `Express.Multer.File` ambient global does
// not resolve reliably under NodeNext module resolution.
interface UploadedPhoto {
  buffer: Buffer;
  originalname: string;
}

@Controller('me')
@UseGuards(AuthGuard, CsrfGuard)
export class MeController {
  constructor(private readonly identity: IdentityService) {}

  /**
   * The SPA's session probe. Returns the actor the guard already resolved, so it doubles as
   * "is my cookie still good" — a 401 here is what triggers the session-expired screen.
   */
  @Get()
  async me(@CurrentUser() actor: RequestUser) {
    return { data: { ...actor, hasPhoto: await this.identity.hasProfilePhoto(actor.id) } };
  }

  @Post('photo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PROFILE_PHOTO_BYTES } }))
  async uploadPhoto(
    @CurrentUser() actor: RequestUser,
    @UploadedFile() file: UploadedPhoto | undefined,
  ) {
    if (file === undefined)
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'A file upload is required under the "file" field',
      });
    return {
      data: await this.identity.setProfilePhoto(actor, {
        buffer: file.buffer,
        originalName: file.originalname,
      }),
    };
  }

  @Get('photo')
  async photo(@CurrentUser() actor: RequestUser, @Res() response: Response): Promise<void> {
    const photo = await this.identity.getProfilePhoto(actor, actor.id);
    response.setHeader('Content-Type', photo.mediaType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('ETag', `"${photo.checksumSha256}"`);
    response.send(photo.content);
  }
}
