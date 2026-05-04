import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({ imports: [PrismaModule, NotificationsModule], controllers: [PostsController], providers: [PostsService] })
export class PostsModule {}
