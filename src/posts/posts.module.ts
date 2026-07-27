import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [PrismaModule, NotificationsModule, AuthModule], controllers: [PostsController], providers: [PostsService] })
export class PostsModule {}
