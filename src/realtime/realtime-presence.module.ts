import { Global, Module } from '@nestjs/common';
import { BuddyModule } from '../buddy/buddy.module';
import { RealtimePresenceService } from './realtime-presence.service';

@Global()
@Module({
  imports: [BuddyModule],
  providers: [RealtimePresenceService],
  exports: [RealtimePresenceService],
})
export class RealtimePresenceModule {}
