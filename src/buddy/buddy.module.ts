import { Module } from '@nestjs/common';
import { BuddyController } from './buddy.controller';
import { BuddyService } from './buddy.service';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [BuddyController], providers: [BuddyService], exports: [BuddyService] })
export class BuddyModule {}
