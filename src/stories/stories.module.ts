import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatModule } from '../chat/chat.module';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';

@Module({ imports: [PrismaModule, ChatModule], controllers: [StoriesController], providers: [StoriesService] })
export class StoriesModule {}
