import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { FeedModule } from './feed/feed.module';
import { GroupsModule } from './groups/groups.module';
import { MailModule } from './mail/mail.module';
import { PostsModule } from './posts/posts.module';
import { PrismaModule } from './prisma/prisma.module';
import { ThemeModule } from './theme/theme.module';
import { UsersModule } from './users/users.module';
import { UploadsModule } from './uploads/uploads.module';
import { NotificationsModule } from './notifications/notifications.module';
import { BuddyModule } from './buddy/buddy.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { ActivitiesModule } from './activities/activities.module';
import { TenorModule } from './tenor/tenor.module';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, MailModule, AuthModule, UsersModule, FeedModule, PostsModule, GroupsModule, ChatModule, ThemeModule, UploadsModule, NotificationsModule, BuddyModule, IntegrationsModule, ActivitiesModule, TenorModule] })
export class AppModule {}
