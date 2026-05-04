import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

@WebSocketGateway({ namespace: '/chat', cors: { origin: true, credentials: true } })
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  constructor(private jwt: JwtService, private config: ConfigService, private chat: ChatService) {}

  async handleConnection(@ConnectedSocket() client: Socket) {
    const userId = await this.userId(client);
    if (!userId) return client.disconnect(true);
    client.data.userId = userId;
    await client.join(`user:${userId}`);
  }

  @SubscribeMessage('chat:send')
  async send(@ConnectedSocket() client: Socket, @MessageBody() body: { recipientId: string; body: string; ciphertext?: string; nonce?: string; encrypted?: boolean }) {
    const senderId = client.data.userId as string | undefined;
    if (!senderId) return null;
    const message = await this.chat.send(senderId, body);
    this.emitMessage(message.recipientId ?? '', 'chat:message', message);
    this.emitMessage(senderId, 'chat:message', message);
    return message;
  }

  @SubscribeMessage('chat:typing')
  typing(@ConnectedSocket() client: Socket, @MessageBody() body: { recipientId: string }) {
    const senderId = client.data.userId as string | undefined;
    if (!senderId || !body.recipientId) return null;
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
    const payload = await this.jwt.verifyAsync<{ sub: string }>(token, { secret: this.config.get<string>('JWT_SECRET') ?? 'dev-secret' }).catch(() => null);
    return payload?.sub ?? null;
  }
}
