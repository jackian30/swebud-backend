import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({ imports: [PrismaModule, NotificationsModule, JwtModule.register({}), ConfigModule], controllers: [ChatController], providers: [ChatService, ChatGateway], exports: [ChatGateway, ChatService] })
export class ChatModule {}
