import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

@Module({ imports: [ChatModule, NotificationsModule], controllers: [GroupsController], providers: [GroupsService] })
export class GroupsModule {}
