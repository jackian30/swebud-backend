import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatModule } from '../chat/chat.module';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [PrismaModule, ChatModule, AuthModule], controllers: [StoriesController], providers: [StoriesService] })
export class StoriesModule {}
