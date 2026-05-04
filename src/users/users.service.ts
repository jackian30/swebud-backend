import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateMeDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  me(userId: string) { return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: this.select() }); }
  updateMe(userId: string, dto: UpdateMeDto) { return this.prisma.user.update({ where: { id: userId }, data: { ...dto, username: dto.username?.toLowerCase().replace(/^@/, '').trim() }, select: this.select() }); }
  async profile(viewerId: string, userId: string) {
    const [profile, isFollowing, followsMe] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { ...this.select(), posts: { orderBy: { createdAt: 'desc' }, include: { images: { orderBy: { sortOrder: 'asc' } }, hashtags: { include: { hashtag: true } } } }, _count: { select: { followers: true, following: true, posts: true, comments: true, likes: true, groupMembers: true } } } }),
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: userId } } }),
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: userId, followingId: viewerId } } }),
    ]);
    return { ...profile, isFollowing: Boolean(isFollowing), followsMe: Boolean(followsMe) };
  }
  search(q = '') { return this.prisma.user.findMany({ where: q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }, { username: { contains: q.toLowerCase().replace(/^@/, ''), mode: 'insensitive' } }] } : {}, take: 25, orderBy: { createdAt: 'desc' }, select: this.publicSelect() }); }
  async follow(userId: string, targetId: string) { if (userId === targetId) throw new BadRequestException('Cannot follow yourself'); const follow = await this.prisma.follow.upsert({ where: { followerId_followingId: { followerId: userId, followingId: targetId } }, create: { followerId: userId, followingId: targetId }, update: {} }); void this.notifications.create({ userId: targetId, actorId: userId, type: 'follow', entityId: userId, message: 'started following you' }); return follow; }
  unfollow(userId: string, targetId: string) { return this.prisma.follow.delete({ where: { followerId_followingId: { followerId: userId, followingId: targetId } } }).catch(() => null).then(() => ({ ok: true })); }
  followers(userId: string) { return this.prisma.follow.findMany({ where: { followingId: userId }, include: { follower: { select: this.publicSelect() } }, orderBy: { createdAt: 'desc' } }).then(rows => rows.map(r => r.follower)); }
  following(userId: string, nonFollowback?: string) { return this.prisma.follow.findMany({ where: { followerId: userId }, include: { following: { select: { ...this.publicSelect(), following: { where: { followingId: userId }, select: { followerId: true } } } } }, orderBy: { createdAt: 'desc' } }).then(rows => rows.map(r => ({ ...r.following, followsBack: r.following.following.length > 0, following: undefined })).filter(u => nonFollowback === 'true' ? !u.followsBack : true)); }
  async mutual(userId: string) { const following = await this.following(userId); return following.filter((u: any) => u.followsBack); }
  async block(userId: string, targetId: string) { if (userId === targetId) throw new BadRequestException('Cannot block yourself'); await this.prisma.follow.deleteMany({ where: { OR: [{ followerId: userId, followingId: targetId }, { followerId: targetId, followingId: userId }] } }); return this.prisma.block.upsert({ where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } }, create: { blockerId: userId, blockedId: targetId }, update: {} }).then(() => ({ blocked: true })); }
  unblock(userId: string, targetId: string) { return this.prisma.block.delete({ where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } } }).catch(() => null).then(() => ({ blocked: false })); }

  private select() { return { id: true, email: true, displayName: true, username: true, bio: true, profileImageUrl: true, coverImageUrl: true, verified: true, latitude: true, longitude: true, theme: true, chatPublicKey: true, createdAt: true, _count: { select: { followers: true, following: true } } } as const; }
  private publicSelect() { return { id: true, email: true, displayName: true, username: true, bio: true, profileImageUrl: true, coverImageUrl: true, verified: true, chatPublicKey: true, createdAt: true } as const; }
}
