import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ConnectIntegrationDto, UpdateIntegrationDto } from './dto';
import { IntegrationsService } from './integrations.service';

@UseGuards(JwtAuthGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private integrations: IntegrationsService) {}
  @Get() list(@CurrentUser() user: AuthUser) { return this.integrations.list(user.id); }
  @Post('connect') connect(@CurrentUser() user: AuthUser, @Body() dto: ConnectIntegrationDto) { return this.integrations.connect(user.id, dto); }
  @Get(':provider/oauth/start') oauthStart(@CurrentUser() user: AuthUser, @Param('provider') provider: IntegrationProvider) { return this.integrations.oauthStart(user.id, provider); }
  @Patch(':provider') update(@CurrentUser() user: AuthUser, @Param('provider') provider: IntegrationProvider, @Body() dto: UpdateIntegrationDto) { return this.integrations.update(user.id, provider, dto); }
  @Delete(':provider') disconnect(@CurrentUser() user: AuthUser, @Param('provider') provider: IntegrationProvider) { return this.integrations.disconnect(user.id, provider); }
}
