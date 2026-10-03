import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard.js';
import { DocumentsService } from './documents.service.js';

/**
 * The configured ways an outgoing document leaves the office (policy register P-15).
 *
 * Its own controller rather than a route under `/documents`, because every path there is
 * `:id`-shaped and `/documents/release-methods` would be read as a document whose id is
 * `release-methods`. Read-only on purpose: decision 27 asks for a list that is *configurable*,
 * which it now is — a method is an INSERT rather than a migration — and an administration screen
 * for it is a separate box, not part of making the list configurable.
 */
@Controller('release-methods')
@UseGuards(AuthGuard)
export class ReleaseMethodsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  async list() {
    return { data: await this.documents.listReleaseMethods() };
  }
}
