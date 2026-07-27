import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AdminRequest } from './admin-moderation.types';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._~:+/-]{7,127}$/;

@Injectable()
export class AdminMutationGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & AdminRequest>();
    const requestId = this.singleHeader(request, 'x-request-id');
    const idempotencyKey = this.singleHeader(request, 'idempotency-key');
    if (!UUID_V4.test(requestId)) throw new BadRequestException('X-Request-ID must be a UUID v4');
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key must be 8-128 safe ASCII characters');
    }
    request.adminMutation = { requestId: requestId.toLowerCase(), idempotencyKey };
    return true;
  }

  private singleHeader(request: Request, name: string) {
    const value = request.headers[name];
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${name === 'x-request-id' ? 'X-Request-ID' : 'Idempotency-Key'} header is required`);
    }
    return value.trim();
  }
}
