import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KlipyController } from './klipy.controller';
import { KlipyService } from './klipy.service';

@Module({ imports: [ConfigModule], controllers: [KlipyController], providers: [KlipyService] })
export class KlipyModule {}
