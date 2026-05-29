import { Injectable, OnModuleDestroy } from '@nestjs/common';

@Injectable()
export class RealtimePresenceService implements OnModuleDestroy {
  private readonly connectionsByUserId = new Map<string, Set<string>>();

  trackConnection(userId: string, connectionId: string) {
    if (!userId || !connectionId) return;
    let connections = this.connectionsByUserId.get(userId);
    if (!connections) {
      connections = new Set<string>();
      this.connectionsByUserId.set(userId, connections);
    }
    connections.add(connectionId);
  }

  trackDisconnection(userId?: string, connectionId?: string) {
    if (!userId || !connectionId) return;
    const connections = this.connectionsByUserId.get(userId);
    if (!connections) return;

    connections.delete(connectionId);
    if (connections.size > 0) return;

    this.connectionsByUserId.delete(userId);
  }

  onModuleDestroy() {
    this.connectionsByUserId.clear();
  }
}
