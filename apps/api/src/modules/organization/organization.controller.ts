import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  createDivisionSchema,
  createDocumentTypeSchema,
  createSectionSchema,
  headOfBureauSchema,
  updateDivisionSchema,
  updateDocumentTypeSchema,
  updateSectionSchema,
  type CreateDivisionInput,
  type CreateDocumentTypeInput,
  type CreateSectionInput,
  type HeadOfBureau,
  type UpdateDivisionInput,
  type UpdateDocumentTypeInput,
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

  @Get('office/head-of-bureau')
  async headOfBureau(@CurrentUser() actor: RequestUser) {
    return { data: await this.organization.getHeadOfBureau(actor) };
  }

  @Put('office/head-of-bureau')
  async setHeadOfBureau(
    @CurrentUser() actor: RequestUser,
    @Body(new ZodValidationPipe(headOfBureauSchema)) input: HeadOfBureau,
  ) {
    return { data: await this.organization.setHeadOfBureau(actor, input) };
  }

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

  @Get('document-types')
  async documentTypes(@CurrentUser() actor: RequestUser) {
    return { data: await this.organization.listDocumentTypes(actor) };
  }

  @Post('document-types')
  async createDocumentType(
    @CurrentUser() actor: RequestUser,
    @Body(new ZodValidationPipe(createDocumentTypeSchema)) input: CreateDocumentTypeInput,
  ) {
    return { data: await this.organization.createDocumentType(actor, input) };
  }

  @Patch('document-types/:id')
  async updateDocumentType(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDocumentTypeSchema)) patch: UpdateDocumentTypeInput,
  ) {
    return { data: await this.organization.updateDocumentType(actor, id, patch) };
  }
}
