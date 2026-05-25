import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { isAllowedOrigin, requiredSecret } from '../common/security';
import { RealtimePresenceService } from '../realtime/realtime-presence.service';

@WebSocketGateway({ namespace: '/notifications' })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private eventBuckets = new Map<string, { count: number; resetAt: number }>();
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
    this.clearSocketBuckets(client.id);
  }

  @SubscribeMessage('buddy:room-typing')
  async buddyRoomTyping(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId?: string }) {
    const senderId = client.data.userId as string | undefined;
    const roomId = body.roomId;
    if (!senderId || !roomId) return null;
    if (!this.allowEvent(client, 'buddy:room-typing', 90)) return null;
    const [session, sender] = await Promise.all([
      this.prisma.buddySession.findFirst({
        where: { userId: senderId, roomId, expiresAt: { gt: new Date() } },
        select: { id: true },
      }),
      this.prisma.user.findUnique({
        where: { id: senderId },
        select: { id: true, displayName: true, username: true, profileImageUrl: true },
      }),
    ]);
    if (!session || !sender) return null;
    const recipients = await this.prisma.buddySession.findMany({
      where: { roomId, userId: { not: senderId }, expiresAt: { gt: new Date() } },
      select: { userId: true },
    });
    const payload = { roomId, senderId, sender, at: new Date().toISOString() };
    for (const recipient of recipients) this.emitToUser(recipient.userId, 'buddy:room-typing', payload);
    return { ok: true };
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  private allowEvent(client: Socket, event: string, limit: number) {
    const key = `${client.id}:${event}`;
    const now = Date.now();
    const bucket = this.eventBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.eventBuckets.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= limit;
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

  private clearSocketBuckets(socketId: string) {
    const prefix = `${socketId}:`;
    for (const key of this.eventBuckets.keys()) {
      if (key.startsWith(prefix)) this.eventBuckets.delete(key);
    }
  }
}
