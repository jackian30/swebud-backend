import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { BuddyService } from '../buddy/buddy.service';

export const OFFLINE_BUDDY_SESSION_GRACE_MS = 2 * 60_000;

@Injectable()
export class RealtimePresenceService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimePresenceService.name);
  private readonly connectionsByUserId = new Map<string, Set<string>>();
  private readonly offlineTimers = new Map<string, NodeJS.Timeout>();

  constructor(private buddy: BuddyService) {}

  trackConnection(userId: string, connectionId: string) {
    if (!userId || !connectionId) return;
    let connections = this.connectionsByUserId.get(userId);
    if (!connections) {
      connections = new Set<string>();
      this.connectionsByUserId.set(userId, connections);
    }
    connections.add(connectionId);
    this.clearOfflineTimer(userId);
  }

  trackDisconnection(userId?: string, connectionId?: string) {
    if (!userId || !connectionId) return;
    const connections = this.connectionsByUserId.get(userId);
    if (!connections) return;

    connections.delete(connectionId);
    if (connections.size > 0) return;

    this.connectionsByUserId.delete(userId);
    this.scheduleOfflineCleanup(userId);
  }

  onModuleDestroy() {
    for (const timer of this.offlineTimers.values()) {
      clearTimeout(timer);
    }
    this.offlineTimers.clear();
    this.connectionsByUserId.clear();
  }

  private scheduleOfflineCleanup(userId: string) {
    this.clearOfflineTimer(userId);
    const timer = setTimeout(() => {
      void this.closeBuddySessionIfStillOffline(userId);
    }, OFFLINE_BUDDY_SESSION_GRACE_MS);
    timer.unref?.();
    this.offlineTimers.set(userId, timer);
  }

  private clearOfflineTimer(userId: string) {
    const timer = this.offlineTimers.get(userId);
    if (!timer) return;
    clearTimeout(timer);
    this.offlineTimers.delete(userId);
  }

  private async closeBuddySessionIfStillOffline(userId: string) {
    this.offlineTimers.delete(userId);
    const connections = this.connectionsByUserId.get(userId);
    if (connections?.size) return;

    try {
      await this.buddy.stop(userId);
    } catch (error) {
      this.logger.warn(`Could not close offline buddy session for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
