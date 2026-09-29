import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  type CreateUserInput,
  type ListUsersQuery,
  type UpdateUserInput,
} from '@dts/contracts';
import { AuthGuard } from '../../common/auth.guard.js';
import { CsrfGuard } from '../../common/csrf.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { IdentityService } from './identity.service.js';

@Controller('users')
@UseGuards(AuthGuard, CsrfGuard)
export class UsersController {
  constructor(private readonly identity: IdentityService) {}

  /** The administration table. Gated on `USER_MANAGE`, and returns the full admin projection. */
  @Get()
  async list(
    @CurrentUser() actor: RequestUser,
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery,
  ) {
    return { data: await this.identity.listUsers(actor, query) };
  }

  /**
   * The assignee picker. Separate from `GET /users` because routing a document is a normal
   * staff action while listing the directory is not: this returns only the fields the picker
   * renders, for only the people the actor may already see.
   */
  @Get('assignable')
  async assignable(@CurrentUser() actor: RequestUser) {
    return { data: await this.identity.listAssignableUsers(actor) };
  }

  @Post()
  async create(
    @CurrentUser() actor: RequestUser,
    @Body(new ZodValidationPipe(createUserSchema)) input: CreateUserInput,
  ) {
    return { data: await this.identity.createUser(actor, input) };
  }

  @Get(':id')
  async get(@CurrentUser() actor: RequestUser, @Param('id') id: string) {
    return { data: await this.identity.getUser(actor, id) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) input: UpdateUserInput,
  ) {
    return { data: await this.identity.updateUser(actor, id, input) };
  }

  @Post(':id/deactivate')
  async deactivate(@CurrentUser() actor: RequestUser, @Param('id') id: string) {
    return { data: await this.identity.deactivateUser(actor, id) };
  }

  @Post(':id/reactivate')
  async reactivate(@CurrentUser() actor: RequestUser, @Param('id') id: string) {
    return { data: await this.identity.reactivateUser(actor, id) };
  }

  @Get(':id/photo')
  async photo(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Res() response: Response,
  ): Promise<void> {
    const photo = await this.identity.getProfilePhoto(actor, id);
    response.setHeader('Content-Type', photo.mediaType);
    // The type was established by sniffing the bytes on upload; do not let a browser
    // re-guess it and possibly treat the response as something executable.
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Private: the photo is only visible to callers the policy allows, so a shared cache
    // must not be allowed to serve it to the next person who asks.
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('ETag', `"${photo.checksumSha256}"`);
    response.send(photo.content);
  }
}
