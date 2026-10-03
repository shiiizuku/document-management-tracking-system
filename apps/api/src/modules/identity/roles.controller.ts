import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard.js';
import { CsrfGuard } from '../../common/csrf.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { roleGrants } from '../authorization/role-grants.js';

/**
 * What each role grants, for the role pickers in user administration (decision 175 as amended).
 *
 * Not audited: it reads a constant, not a record. Cacheable for a few minutes because the table
 * only changes on deploy.
 */
@Controller('roles')
@UseGuards(AuthGuard, CsrfGuard)
export class RolesController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Get()
  @Header('Cache-Control', 'private, max-age=300')
  list(@CurrentUser() actor: RequestUser) {
    this.authorization.assert(actor, 'role:list');
    return { data: roleGrants() };
  }
}
