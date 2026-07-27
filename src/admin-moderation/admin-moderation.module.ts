import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminJwtGuard } from './admin-jwt.guard';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminModerationService } from './admin-moderation.service';
import { AdminMutationGuard } from './admin-mutation.guard';
import { AdminScopesGuard } from './admin-scopes.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminModerationController],
  providers: [
    AdminModerationService,
    AdminJwtGuard,
    AdminScopesGuard,
    AdminMutationGuard,
  ],
})
export class AdminModerationModule {}
