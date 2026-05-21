import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { isAllowedOrigin, requiredSecret } from '../common/security';
import { RealtimePresenceService } from '../realtime/realtime-presence.service';

@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private eventBuckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private jwt: JwtService, private config: ConfigService, private chat: ChatService, private prisma: PrismaService, private presence: RealtimePresenceService) {}

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

  @SubscribeMessage('chat:send')
  async send(@ConnectedSocket() client: Socket, @MessageBody() body: { recipientId: string; body: string; ciphertext?: string; nonce?: string; encrypted?: boolean }) {
    const senderId = client.data.userId as string | undefined;
    if (!senderId) return null;
    if (!this.allowEvent(client, 'chat:send', 30)) return null;
    const message = await this.chat.send(senderId, body);
    this.emitMessage(message.recipientId ?? '', 'chat:message', message);
    this.emitMessage(senderId, 'chat:message', message);
    return message;
  }

  @SubscribeMessage('chat:typing')
  typing(@ConnectedSocket() client: Socket, @MessageBody() body: { recipientId: string }) {
    const senderId = client.data.userId as string | undefined;
    if (!senderId || !body.recipientId) return null;
    if (!this.allowEvent(client, 'chat:typing', 90)) return null;
    this.emitMessage(body.recipientId, 'chat:typing', { senderId });
    return { ok: true };
  }

  emitMessage(userId: string, event: string, payload: unknown) {
    if (!userId) return;
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

  private presenceConnectionId(client: Socket) {
    return `chat:${client.id}`;
  }

  private clearSocketBuckets(socketId: string) {
    const prefix = `${socketId}:`;
    for (const key of this.eventBuckets.keys()) {
      if (key.startsWith(prefix)) this.eventBuckets.delete(key);
    }
  }
}
