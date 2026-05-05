import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenorController } from './tenor.controller';
import { TenorService } from './tenor.service';

@Module({ imports: [ConfigModule], controllers: [TenorController], providers: [TenorService] })
export class TenorModule {}
