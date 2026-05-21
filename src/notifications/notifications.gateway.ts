import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConnectedSocket, OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { isAllowedOrigin, requiredSecret } from '../common/security';
import { RealtimePresenceService } from '../realtime/realtime-presence.service';

@WebSocketGateway({ namespace: '/notifications' })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  constructor(private jwt: JwtService, private config: ConfigService, private prisma: PrismaService, private presence: RealtimePresenceService) {}

  async handleConnection(@ConnectedSocket() client: Socket) {
    if (!isAllowedOrigin(this.config, client.handshake.headers.origin)) return client.disconnect(true);
    const userId = await this.userId(client);
    if (!userId) return client.disconnect(true);
    client.data.userId = userId;
    client.data.presenceConnectionId = this.presenceConnectionId(client);
    this.presence.trackConnection(userId, client.data.presenceConnectionId);
    await client.join(`user:${userId}`);
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;
    const connectionId = client.data.presenceConnectionId as string | undefined;
    this.presence.trackDisconnection(userId, connectionId);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  private async userId(client: Socket) {
    const token = client.handshake.auth?.token || String(client.handshake.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return null;
    const payload = await this.jwt.verifyAsync<{ sub: string; sid?: string }>(token, { secret: requiredSecret(this.config, 'JWT_SECRET', 'dev-secret') }).catch(() => null);
    if (!payload?.sub || !payload.sid) return null;
    const session = await this.prisma.refreshToken.findFirst({
      where: { id: payload.sid, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return session ? payload.sub : null;
  }

  private presenceConnectionId(client: Socket) {
    return `notifications:${client.id}`;
  }
}
