import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsController } from './notifications.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

@Module({ imports: [PrismaModule, JwtModule.register({}), ConfigModule], controllers: [NotificationsController], providers: [NotificationsService, NotificationsGateway], exports: [NotificationsService, NotificationsGateway] })
export class NotificationsModule {}
