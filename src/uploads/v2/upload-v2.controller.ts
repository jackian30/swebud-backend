import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { VerifiedAccountGuard } from '../../auth/verified-account.guard';
import { AuthUser, CurrentUser } from '../../common/current-user.decorator';
import { UuidParam } from '../../common/uuid-param.decorator';
import {
  CompleteUploadDto,
  CreateUploadSessionDto,
  MintUploadPartsDto,
} from './upload-v2.dto';
import { UploadV2Service } from './upload-v2.service';
import { UploadV2ExceptionFilter } from './upload-v2-exception.filter';

@UseGuards(JwtAuthGuard, VerifiedAccountGuard)
@UseFilters(UploadV2ExceptionFilter)
@Controller('uploads/v2')
export class UploadV2Controller {
  constructor(private readonly uploads: UploadV2Service) {}

  @Post('sessions')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUploadSessionDto) {
    return this.uploads.create(user.id, dto);
  }

  @Post('sessions/:sessionId/parts')
  mintParts(
    @CurrentUser() user: AuthUser,
    @UuidParam('sessionId') sessionId: string,
    @Body() dto: MintUploadPartsDto,
  ) {
    return this.uploads.mintParts(user.id, sessionId, dto);
  }

  @Get('sessions/:sessionId/parts')
  progress(
    @CurrentUser() user: AuthUser,
    @UuidParam('sessionId') sessionId: string,
  ) {
    return this.uploads.progress(user.id, sessionId);
  }

  @Post('sessions/:sessionId/complete')
  complete(
    @CurrentUser() user: AuthUser,
    @UuidParam('sessionId') sessionId: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.uploads.complete(user.id, sessionId, dto);
  }

  @Get('sessions/:sessionId')
  status(
    @CurrentUser() user: AuthUser,
    @UuidParam('sessionId') sessionId: string,
  ) {
    return this.uploads.status(user.id, sessionId);
  }

  @Delete('sessions/:sessionId')
  cancel(
    @CurrentUser() user: AuthUser,
    @UuidParam('sessionId') sessionId: string,
  ) {
    return this.uploads.cancel(user.id, sessionId);
  }
}
