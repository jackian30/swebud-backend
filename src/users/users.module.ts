import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({ imports: [PrismaModule, NotificationsModule], controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
