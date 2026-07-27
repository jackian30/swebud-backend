import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { booleanConfig } from '../common/config';

@Injectable()
export class LegacyProxyUploadGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(_context: ExecutionContext) {
    const enabled = booleanConfig(
      this.config,
      'MEDIA_LEGACY_PROXY_UPLOADS_ENABLED',
      process.env.NODE_ENV !== 'production',
    );
    if (!enabled) throw new NotFoundException('Legacy proxy uploads are disabled. Use /uploads/v2.');
    return true;
  }
}
