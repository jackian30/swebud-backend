import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { isAllowedOrigin, requiredSecret } from '../common/security';
import { RealtimePresenceService } from '../realtime/realtime-presence.service';
import { isAccountBanned, moderationStateSelect } from '../auth/account-status';
import { isOnboardingComplete, onboardingStateSelect } from '../auth/account-status';
import { SocketAuthMonitor } from '../common/socket-auth-monitor';
import { SendDirectMessageDto, TypingDto } from './dto';

@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private eventBuckets = new Map<string, { count: number; resetAt: number }>();
  private readonly authMonitor = new SocketAuthMonitor();
  constructor(private jwt: JwtService, private config: ConfigService, private chat: ChatService, private prisma: PrismaService, private presence: RealtimePresenceService) {}

  async handleConnection(@ConnectedSocket() client: Socket) {
    if (!isAllowedOrigin(this.config, client.handshake.headers.origin)) return client.disconnect(true);
    const authenticated = await this.authenticatedSession(client);
    if (!authenticated) return this.authMonitor.disconnect(client);
    client.data.userId = authenticated.userId;
    client.data.presenceConnectionId = this.presenceConnectionId(client);
    this.presence.trackConnection(authenticated.userId, client.data.presenceConnectionId);
    await client.join(`user:${authenticated.userId}`);
    this.authMonitor.start(client, authenticated.accessTokenExpiresAtMs, async () => {
      const current = await this.authenticatedSession(client);
      return current?.userId === authenticated.userId;
    });
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;
    const connectionId = client.data.presenceConnectionId as string | undefined;
    this.presence.trackDisconnection(userId, connectionId);
    this.authMonitor.stop(client.id);
    this.clearSocketBuckets(client.id);
  }

  @SubscribeMessage('chat:send')
  async send(@ConnectedSocket() client: Socket, @MessageBody() body: SendDirectMessageDto) {
    const senderId = await this.activeUserId(client);
    if (!senderId) return null;
    if (!this.allowEvent(client, 'chat:send', 30)) return null;
    const message = await this.chat.send(senderId, body);
    this.emitMessage(message.recipientId ?? '', 'chat:message', message);
    this.emitMessage(senderId, 'chat:message', message);
    return message;
  }

  @SubscribeMessage('chat:typing')
  async typing(@ConnectedSocket() client: Socket, @MessageBody() body: TypingDto) {
    const senderId = await this.activeUserId(client);
    if (!senderId || !body.recipientId) return null;
    if (!this.allowEvent(client, 'chat:typing', 90)) return null;
    await this.chat.assertDirectMessagingAllowed(senderId, body.recipientId);
    this.emitMessage(body.recipientId, 'chat:typing', { senderId });
    return { ok: true };
  }

  emitMessage(userId: string, event: string, payload: unknown) {
    if (!userId) return;
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  private async authenticatedSession(client: Socket) {
    const token = client.handshake.auth?.token || String(client.handshake.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return null;
    const payload = await this.jwt.verifyAsync<{ sub: string; sid?: string; exp?: number }>(token, { secret: requiredSecret(this.config, 'JWT_SECRET', 'dev-secret') }).catch(() => null);
    if (!payload?.sub || !payload.sid || !Number.isFinite(payload.exp)) return null;
    const session = await this.prisma.refreshToken.findFirst({
      where: { id: payload.sid, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        user: { select: { ...moderationStateSelect, ...onboardingStateSelect } },
      },
    }).catch(() => null);
    if (!session || isAccountBanned(session.user) || !isOnboardingComplete(session.user)) return null;
    return { userId: payload.sub, accessTokenExpiresAtMs: payload.exp! * 1000 };
  }

  private async activeUserId(client: Socket) {
    const connectedUserId = client.data.userId as string | undefined;
    if (!connectedUserId) return null;
    const authenticated = await this.authenticatedSession(client);
    if (authenticated?.userId !== connectedUserId) {
      this.authMonitor.disconnect(client);
      return null;
    }
    return authenticated.userId;
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
