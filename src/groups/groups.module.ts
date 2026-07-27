import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [ChatModule, NotificationsModule, AuthModule], controllers: [GroupsController], providers: [GroupsService] })
export class GroupsModule {}
