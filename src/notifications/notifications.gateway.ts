import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConnectedSocket, OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: '/notifications', cors: { origin: true, credentials: true } })
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  constructor(private jwt: JwtService, private config: ConfigService) {}

  async handleConnection(@ConnectedSocket() client: Socket) {
    const userId = await this.userId(client);
    if (!userId) return client.disconnect(true);
    await client.join(`user:${userId}`);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  private async userId(client: Socket) {
    const token = client.handshake.auth?.token || String(client.handshake.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return null;
    const payload = await this.jwt.verifyAsync<{ sub: string }>(token, { secret: this.config.get<string>('JWT_SECRET') ?? 'dev-secret' }).catch(() => null);
    return payload?.sub ?? null;
  }
}
