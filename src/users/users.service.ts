import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteUserOnboardingDto, ReportUserDto, UpdateAccountDto, UpdateMeDto, UpdatePasswordDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';
import { visibleAuthorWhere, visiblePostWhere } from '../privacy/privacy';
import { activityPersonaLinkSelect, exposeActivityPersonas, replaceActivityPersonaLinks } from '../common/activity-personas';
import { availableProfileBadgesFor, exposeProfileBadges, profileBadgeSelect } from '../common/profile-badges';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  async me(userId: string) { return this.withOnboarding(await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: this.select() })); }
  async updateMe(userId: string, dto: UpdateMeDto) {
    const username = dto.username?.toLowerCase().replace(/^@/, '').trim().replace(/[^a-z0-9._-]/g, '');
    const { displayName, activityPersonas, ...rest } = dto;
    delete rest.username;
    delete rest.activityPersona;
    if (dto.username !== undefined) {
      if (!username) throw new BadRequestException('Username is required');
      const existing = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
      if (existing && existing.id !== userId) throw new ConflictException('Username already taken');
    }
    const user = await this.prisma.user.update({ where: { id: userId }, data: { ...rest, ...(activityPersonas !== undefined ? { activityPersonas: replaceActivityPersonaLinks(activityPersonas) } : {}), ...(username ? { username, usernameFinalized: true } : {}), ...(displayName !== undefined ? { displayName: displayName.trim() || null } : {}) }, select: this.select() });
    return this.withOnboarding(user);
  }
  async completeOnboarding(userId: string, dto: CompleteUserOnboardingDto) {
    if (!dto.legalConsent || !dto.dataConsent) throw new BadRequestException('Legal and data consent are required');
    const username = dto.username?.toLowerCase().replace(/^@/, '').trim().replace(/[^a-z0-9._-]/g, '');
    if (!username) throw new BadRequestException('Username is required');
    if (!dto.dateOfBirth) throw new BadRequestException('Birth date is required');
    const existing = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (existing && existing.id !== userId) throw new ConflictException('Username already taken');
    const activityPersonas = dto.activityPersonas ?? [];
    const user = await this.prisma.user.update({ where: { id: userId }, data: { username, usernameFinalized: true, dateOfBirth: dto.dateOfBirth, legalConsentAt: new Date(), dataConsentAt: new Date(), activityPersonas: replaceActivityPersonaLinks(activityPersonas) }, select: this.select() });
    return this.withOnboarding(user);
  }
  async updateAccount(userId: string, dto: UpdateAccountDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, passwordHash: true } });
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) throw new UnauthorizedException('Current password is incorrect');
    const email = dto.email.toLowerCase().trim();
    if (email !== user.email) {
      const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing && existing.id !== userId) throw new ConflictException('Email already registered');
    }
    return this.prisma.user.update({ where: { id: userId }, data: { email }, select: this.select() }).then((user) => this.withOnboarding(user));
  }
  async updatePassword(userId: string, dto: UpdatePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) throw new UnauthorizedException('Current password is incorrect');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(dto.newPassword, 12) } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { ok: true };
  }
  sessions(userId: string, currentSessionId?: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, createdAt: true, expiresAt: true, revokedAt: true },
    }).then((sessions) => sessions.map((session) => ({ ...session, current: session.id === currentSessionId, active: !session.revokedAt && session.expiresAt > new Date() })));
  }

  async revokeSession(userId: string, sessionId: string) {
    await this.prisma.refreshToken.updateMany({ where: { id: sessionId, userId }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  async profile(viewerId: string, identifier: string) {
    const userId = await this.resolveUserId(identifier);
    const canViewProfile = Boolean(await this.prisma.user.findFirst({ where: { id: userId, ...visibleAuthorWhere(viewerId) }, select: { id: true } }));
    const [isFollowing, followsMe, isCloseBuddy, pendingFollowRequest] = await Promise.all([
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: userId } } }),
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: userId, followingId: viewerId } } }),
      this.prisma.closeBuddy.findUnique({ where: { ownerId_buddyId: { ownerId: userId, buddyId: viewerId } } }),
      this.prisma.followRequest.findUnique({ where: { requesterId_recipientId: { requesterId: viewerId, recipientId: userId } } }),
    ]);
    if (!canViewProfile) {
      const profile = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { ...this.publicSelect(), _count: { select: { followers: true, following: true } } },
      });
      return {
        ...exposeProfileBadges(exposeActivityPersonas(profile)),
        posts: [],
        reposts: [],
        isFollowing: Boolean(isFollowing),
        followsMe: Boolean(followsMe),
        isCloseBuddy: Boolean(isCloseBuddy),
        isPrivateLocked: true,
        followRequestStatus: pendingFollowRequest?.status ?? null,
      };
    }
    const profile = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        ...this.publicSelect(),
        reposts: {
          where: { post: visiblePostWhere(viewerId) },
          orderBy: { createdAt: 'desc' },
          include: {
            post: {
              include: {
                author: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
                group: { select: { id: true, name: true, slug: true, visibility: true } },
                images: { orderBy: { sortOrder: 'asc' } },
                hashtags: { include: { hashtag: true } },
                taggedUsers: { include: { user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } } }, orderBy: { createdAt: 'asc' } },
              },
            },
          },
        },
        _count: { select: { followers: true, following: true, posts: true, comments: true, likes: true, groupMembers: true, reposts: true } },
      },
    });
    const posts = await this.prisma.post.findMany({
      where: {
        AND: [
          visiblePostWhere(viewerId),
          { groupId: null },
          { OR: [{ authorId: userId, profileOwnerId: null }, { profileOwnerId: userId }] },
        ],
      },
      orderBy: [{ pinnedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        author: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
        profileOwner: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
        activity: true,
        images: { orderBy: { sortOrder: 'asc' } },
        hashtags: { include: { hashtag: true } },
        taggedUsers: { include: { user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    return { ...exposeProfileBadges(exposeActivityPersonas(profile)), posts, isFollowing: Boolean(isFollowing), followsMe: Boolean(followsMe), isCloseBuddy: Boolean(isCloseBuddy), isPrivateLocked: false, followRequestStatus: pendingFollowRequest?.status ?? null };
  }
  search(q = '') { return this.prisma.user.findMany({ where: q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }, { username: { contains: q.toLowerCase().replace(/^@/, ''), mode: 'insensitive' } }] } : {}, take: 25, orderBy: { createdAt: 'desc' }, select: this.publicSelect() }).then((users) => users.map((user) => exposeProfileBadges(exposeActivityPersonas(user)))); }
  async follow(userId: string, identifier: string) {
    const targetId = await this.resolveUserId(identifier);
    if (userId === targetId) throw new BadRequestException('Cannot follow yourself');
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true, profileVisibility: true, blocksSent: { where: { blockedId: userId }, select: { blockerId: true } }, blocksReceived: { where: { blockerId: userId }, select: { blockerId: true } } } });
    if (!target) throw new NotFoundException('User not found');
    if (target.blocksSent.length || target.blocksReceived.length) throw new ForbiddenException('Cannot follow this user');
    const existing = await this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: userId, followingId: targetId } } });
    if (existing) return { status: 'following', follow: existing };
    if (target.profileVisibility === 'private') {
      const request = await this.prisma.followRequest.upsert({
        where: { requesterId_recipientId: { requesterId: userId, recipientId: targetId } },
        create: { requesterId: userId, recipientId: targetId },
        update: { status: 'pending' },
      });
      void this.notifications.create({ userId: targetId, actorId: userId, type: 'follow_request', entityId: request.id, message: 'requested to follow you' });
      return { status: 'requested', request };
    }
    const follow = await this.prisma.follow.upsert({ where: { followerId_followingId: { followerId: userId, followingId: targetId } }, create: { followerId: userId, followingId: targetId }, update: {} });
    await this.prisma.followRequest.deleteMany({ where: { requesterId: userId, recipientId: targetId } });
    void this.notifications.create({ userId: targetId, actorId: userId, type: 'follow', entityId: userId, message: 'started following you' });
    return { status: 'following', follow };
  }
  async unfollow(userId: string, identifier: string) {
    const targetId = await this.resolveUserId(identifier);
    return this.prisma.$transaction([this.prisma.follow.deleteMany({ where: { followerId: userId, followingId: targetId } }), this.prisma.followRequest.deleteMany({ where: { requesterId: userId, recipientId: targetId, status: 'pending' } })]).then(() => ({ ok: true }));
  }
  incomingFollowRequests(userId: string) { return this.prisma.followRequest.findMany({ where: { recipientId: userId, status: 'pending' }, include: { requester: { select: this.publicSelect() } }, orderBy: { createdAt: 'desc' } }).then((rows) => rows.map((row) => ({ ...row, requester: exposeProfileBadges(exposeActivityPersonas(row.requester)) }))); }
  sentFollowRequests(userId: string) { return this.prisma.followRequest.findMany({ where: { requesterId: userId, status: 'pending' }, include: { recipient: { select: this.publicSelect() } }, orderBy: { createdAt: 'desc' } }).then((rows) => rows.map((row) => ({ ...row, recipient: exposeProfileBadges(exposeActivityPersonas(row.recipient)) }))); }
  async acceptFollowRequest(userId: string, requestId: string) {
    const request = await this.prisma.followRequest.findFirst({ where: { id: requestId, recipientId: userId, status: 'pending' } });
    if (!request) throw new NotFoundException('Follow request not found');
    const [, follow] = await this.prisma.$transaction([
      this.prisma.followRequest.update({ where: { id: requestId }, data: { status: 'accepted' } }),
      this.prisma.follow.upsert({ where: { followerId_followingId: { followerId: request.requesterId, followingId: userId } }, create: { followerId: request.requesterId, followingId: userId }, update: {} }),
    ]);
    void this.notifications.create({ userId: request.requesterId, actorId: userId, type: 'follow', entityId: userId, message: 'accepted your follow request' });
    return { status: 'following', follow };
  }
  async declineFollowRequest(userId: string, requestId: string) {
    const updated = await this.prisma.followRequest.updateMany({ where: { id: requestId, recipientId: userId, status: 'pending' }, data: { status: 'declined' } });
    if (!updated.count) throw new NotFoundException('Follow request not found');
    return { status: 'declined' };
  }
  cancelFollowRequest(userId: string, requestId: string) { return this.prisma.followRequest.deleteMany({ where: { id: requestId, requesterId: userId, status: 'pending' } }).then(() => ({ ok: true })); }
  async addCloseBuddy(userId: string, identifier: string) {
    const targetId = await this.resolveUserId(identifier);
    if (userId === targetId) throw new BadRequestException('Cannot add yourself as a close buddy');
    return this.prisma.closeBuddy.upsert({ where: { ownerId_buddyId: { ownerId: userId, buddyId: targetId } }, create: { ownerId: userId, buddyId: targetId }, update: {} }).then(() => ({ closeBuddy: true }));
  }
  async removeCloseBuddy(userId: string, identifier: string) {
    const targetId = await this.resolveUserId(identifier);
    return this.prisma.closeBuddy.delete({ where: { ownerId_buddyId: { ownerId: userId, buddyId: targetId } } }).catch(() => null).then(() => ({ closeBuddy: false }));
  }
  closeBuddies(userId: string) { return this.prisma.closeBuddy.findMany({ where: { ownerId: userId }, include: { buddy: { select: this.publicSelect() } }, orderBy: { createdAt: 'desc' } }).then(rows => rows.map(r => exposeProfileBadges(exposeActivityPersonas(r.buddy)))); }
  followers(userId: string) { return this.profileFollowers(userId, userId); }
  async profileFollowers(identifier: string, viewerId = identifier) {
    const userId = await this.resolveUserId(identifier);
    return this.prisma.follow.findMany({
      where: { followingId: userId, follower: visibleAuthorWhere(viewerId) },
      include: { follower: { select: this.publicSelect() } },
      orderBy: { createdAt: 'desc' },
    }).then(rows => rows.map(r => exposeProfileBadges(exposeActivityPersonas(r.follower))));
  }
  following(userId: string, nonFollowback?: string) { return this.profileFollowing(userId, userId).then(users => users.filter((u: any) => nonFollowback === 'true' ? !u.followsBack : true)); }
  async profileFollowing(identifier: string, viewerId = identifier) {
    const userId = await this.resolveUserId(identifier);
    return this.prisma.follow.findMany({
      where: { followerId: userId, following: visibleAuthorWhere(viewerId) },
      include: { following: { select: { ...this.publicSelect(), following: { where: { followingId: userId }, select: { followerId: true } } } } },
      orderBy: { createdAt: 'desc' },
    }).then(rows => rows.map(r => ({ ...exposeProfileBadges(exposeActivityPersonas(r.following)), followsBack: r.following.following.length > 0, following: undefined })));
  }
  async mutual(userId: string) { const following = await this.following(userId); return following.filter((u: any) => u.followsBack); }
  async block(userId: string, identifier: string) {
    const targetId = await this.resolveUserId(identifier);
    if (userId === targetId) throw new BadRequestException('Cannot block yourself');
    await this.prisma.$transaction([this.prisma.follow.deleteMany({ where: { OR: [{ followerId: userId, followingId: targetId }, { followerId: targetId, followingId: userId }] } }), this.prisma.followRequest.deleteMany({ where: { OR: [{ requesterId: userId, recipientId: targetId }, { requesterId: targetId, recipientId: userId }] } })]);
    return this.prisma.block.upsert({ where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } }, create: { blockerId: userId, blockedId: targetId }, update: {} }).then(() => ({ blocked: true }));
  }
  async unblock(userId: string, identifier: string) {
    const targetId = await this.resolveUserId(identifier);
    return this.prisma.block.delete({ where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } } }).catch(() => null).then(() => ({ blocked: false }));
  }
  async report(userId: string, identifier: string, dto: ReportUserDto) {
    const targetId = await this.resolveUserId(identifier);
    if (userId === targetId) throw new BadRequestException('Cannot report yourself');
    const note = dto.note?.trim();
    await this.prisma.userReport.upsert({
      where: { reportedId_reporterId: { reportedId: targetId, reporterId: userId } },
      create: { reportedId: targetId, reporterId: userId, reason: dto.reason ?? 'other', note: note || null },
      update: { reason: dto.reason ?? 'other', note: note || null },
    });
    return { ok: true };
  }

  private withOnboarding<T extends { usernameFinalized?: boolean | null; dateOfBirth?: Date | string | null; legalConsentAt?: Date | string | null; dataConsentAt?: Date | string | null; activityPersonas?: any; betaUser?: boolean | null; hideProfileBadges?: boolean | null; hiddenProfileBadgeCodes?: string[] | null; badges?: any }>(user: T) {
    const visibleUser = exposeProfileBadges(exposeActivityPersonas(user));
    return {
      ...visibleUser,
      hiddenProfileBadgeCodes: user.hiddenProfileBadgeCodes ?? [],
      availableProfileBadges: availableProfileBadgesFor(user),
      onboardingComplete: Boolean(user.usernameFinalized && user.dateOfBirth && user.legalConsentAt && user.dataConsentAt),
    };
  }
  private select() { return { id: true, email: true, displayName: true, username: true, usernameFinalized: true, bio: true, profileImageUrl: true, coverImageUrl: true, gender: true, dateOfBirth: true, activityPersonas: activityPersonaLinkSelect, legalConsentAt: true, dataConsentAt: true, profileVisibility: true, defaultPostVisibility: true, betaUser: true, hideProfileBadges: true, hiddenProfileBadgeCodes: true, badges: { select: profileBadgeSelect }, verified: true, latitude: true, longitude: true, theme: true, chatPublicKey: true, createdAt: true, _count: { select: { followers: true, following: true } } } as const; }
  private publicSelect() { return { id: true, displayName: true, username: true, usernameFinalized: true, bio: true, profileImageUrl: true, coverImageUrl: true, activityPersonas: activityPersonaLinkSelect, profileVisibility: true, betaUser: true, hideProfileBadges: true, hiddenProfileBadgeCodes: true, badges: { select: profileBadgeSelect }, verified: true, chatPublicKey: true, createdAt: true } as const; }
  private async resolveUserId(identifier: string) {
    const normalized = identifier.toLowerCase().replace(/^@/, '').trim();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: identifier }, { username: normalized }] },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user.id;
  }
}
