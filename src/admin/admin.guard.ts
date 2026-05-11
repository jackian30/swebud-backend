import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user.decorator';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const userId = request.user?.id;
    if (!userId) throw new ForbiddenException('Admin access is required');

    const admin = await this.prisma.user.findFirst({
      where: { id: userId, roles: { some: { role: { key: 'admin' } } } },
      select: { id: true },
    });
    if (!admin) throw new ForbiddenException('Admin access is required');
    return true;
  }
}
