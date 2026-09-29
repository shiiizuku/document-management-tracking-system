import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  createDivisionSchema,
  createSectionSchema,
  updateDivisionSchema,
  updateSectionSchema,
  type CreateDivisionInput,
  type CreateSectionInput,
  type UpdateDivisionInput,
  type UpdateSectionInput,
} from '@dts/contracts';
import { AuthGuard } from '../../common/auth.guard.js';
import { CsrfGuard } from '../../common/csrf.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { OrganizationService } from './organization.service.js';

@Controller()
@UseGuards(AuthGuard, CsrfGuard)
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get('divisions')
  async divisions(@CurrentUser() actor: RequestUser) {
    return { data: await this.organization.listDivisions(actor) };
  }

  @Post('divisions')
  async createDivision(
    @CurrentUser() actor: RequestUser,
    @Body(new ZodValidationPipe(createDivisionSchema)) input: CreateDivisionInput,
  ) {
    return { data: await this.organization.createDivision(actor, input) };
  }

  @Patch('divisions/:id')
  async updateDivision(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDivisionSchema)) patch: UpdateDivisionInput,
  ) {
    return { data: await this.organization.updateDivision(actor, id, patch) };
  }

  @Get('sections')
  async sections(@CurrentUser() actor: RequestUser, @Query('divisionId') divisionId?: string) {
    return { data: await this.organization.listSections(actor, divisionId) };
  }

  @Post('sections')
  async createSection(
    @CurrentUser() actor: RequestUser,
    @Body(new ZodValidationPipe(createSectionSchema)) input: CreateSectionInput,
  ) {
    return { data: await this.organization.createSection(actor, input) };
  }

  @Patch('sections/:id')
  async updateSection(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSectionSchema)) patch: UpdateSectionInput,
  ) {
    return { data: await this.organization.updateSection(actor, id, patch) };
  }
}
