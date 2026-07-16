import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteUserOnboardingDto, DeleteMeDto, ReportUserDto, SaveSearchHistoryDto, UpdateAccountDto, UpdateMeDto, UpdatePasswordDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';
import { assertCanViewProfile, visibleAuthorWhere, visiblePostWhere } from '../privacy/privacy';
import { activityPersonaLinkSelect, exposeActivityPersonas, replaceActivityPersonaLinks } from '../common/activity-personas';
import { availableProfileBadgesFor, exposeProfileBadges, profileBadgeSelect } from '../common/profile-badges';
import { normalizeUsername } from '../common/usernames';
import { presentPublicPost, publicActivitySelect, publicBuddySessionRecapSelect } from '../common/post-presentation';

type PublicPresentationUser = Parameters<typeof exposeActivityPersonas>[0] & Parameters<typeof exposeProfileBadges>[0];

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  async me(userId: string) { return this.withOnboarding(await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: this.select() })); }
  async updateMe(userId: string, dto: UpdateMeDto) {
    const username = normalizeUsername(dto.username);
    const { displayName, activityPersona, activityPersonas, ...rest } = dto;
    delete rest.username;
    const requestedActivityPersonas = activityPersonas !== undefined
      ? activityPersonas
      : activityPersona !== undefined
        ? activityPersona === null ? [] : [activityPersona]
        : undefined;
    if (dto.username !== undefined) {
      if (!username) throw new BadRequestException('Username is required');
      const existing = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
      if (existing && existing.id !== userId) throw new ConflictException('Username already taken');
    }
    const user = await this.prisma.user.update({ where: { id: userId }, data: { ...rest, ...(requestedActivityPersonas !== undefined ? { activityPersonas: replaceActivityPersonaLinks(requestedActivityPersonas) } : {}), ...(username ? { username, usernameFinalized: true } : {}), ...(displayName !== undefined ? { displayName: displayName.trim() || null } : {}) }, select: this.select() });
    return this.withOnboarding(user);
  }
  async completeOnboarding(userId: string, dto: CompleteUserOnboardingDto) {
    if (!dto.legalConsent || !dto.dataConsent) throw new BadRequestException('Legal and data consent are required');
    const username = normalizeUsername(dto.username);
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
      this.prisma.loginSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { ok: true };
  }
  sessions(userId: string, currentSessionId?: string | null) {
    return this.prisma.loginSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, createdAt: true, expiresAt: true, revokedAt: true, deviceLabel: true, locationLabel: true, ipAddress: true, userAgent: true },
    }).then((sessions) => sessions.map((session) => ({ ...session, current: session.id === currentSessionId, active: !session.revokedAt && session.expiresAt > new Date() })));
  }

  async revokeSession(userId: string, sessionId: string) {
    const revokedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.loginSession.updateMany({ where: { id: sessionId, userId }, data: { revokedAt } }),
      this.prisma.refreshToken.updateMany({ where: { loginSessionId: sessionId, userId, revokedAt: null }, data: { revokedAt } }),
    ]);
    return { ok: true };
  }

  async deleteMe(userId: string, dto: DeleteMeDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, username: true } });
    const expectedConfirmation = `delete @${user.username}`;
    if (dto.confirmation.trim() !== expectedConfirmation) {
      throw new BadRequestException(`Type "${expectedConfirmation}" to delete your account`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.post.updateMany({ where: { activity: { userId } }, data: { activityId: null } });
      await tx.messageReaction.deleteMany({ where: { userId } });
      await tx.postEditHistory.deleteMany({ where: { editorId: userId } });
      await tx.commentEditHistory.deleteMany({ where: { editorId: userId } });
      await tx.message.updateMany({ where: { deletedById: userId }, data: { deletedById: null } });
      await tx.buddySessionMessage.updateMany({ where: { deletedById: userId }, data: { deletedById: null } });
      await tx.buddyRoomParticipant.updateMany({ where: { kickedById: userId }, data: { kickedById: null } });
      await tx.buddyGroupChatMember.updateMany({ where: { addedById: userId }, data: { addedById: null } });
      await tx.postReport.updateMany({ where: { reviewedById: userId }, data: { reviewedById: null } });
      await tx.userReport.updateMany({ where: { reviewedById: userId }, data: { reviewedById: null } });
      await tx.groupReport.updateMany({ where: { reviewedById: userId }, data: { reviewedById: null } });
      await tx.userBadge.updateMany({ where: { assignedBy: userId }, data: { assignedBy: null } });
      await tx.notification.deleteMany({ where: { OR: [{ actorId: userId }, { entityId: userId }] } });
      await tx.user.delete({ where: { id: userId } });
      await tx.hashtag.deleteMany({ where: { posts: { none: {} } } });
      await this.recomputeEngagementCounters(tx);
    });

    return { ok: true };
  }

  async profile(viewerId: string, identifier: string) {
    const userId = await this.resolveUserId(identifier);
    const canViewProfile = Boolean(await this.prisma.user.findFirst({ where: { id: userId, ...visibleAuthorWhere(viewerId) }, select: { id: true } }));
    const [isFollowing, followsMe, isCloseBuddy, pendingFollowRequest, blockSent, blockReceived] = await Promise.all([
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: userId } } }),
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: userId, followingId: viewerId } } }),
      this.prisma.closeBuddy.findUnique({ where: { ownerId_buddyId: { ownerId: userId, buddyId: viewerId } } }),
      this.prisma.followRequest.findUnique({ where: { requesterId_recipientId: { requesterId: viewerId, recipientId: userId } } }),
      this.prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: viewerId, blockedId: userId } } }),
      this.prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: userId, blockedId: viewerId } } }),
    ]);
    const isBlockedByMe = Boolean(blockSent);
    const hasBlockedMe = Boolean(blockReceived);
    if (isBlockedByMe || hasBlockedMe) {
      return {
        id: userId,
        posts: [],
        reposts: [],
        isPrivateLocked: true,
        isBlockedByMe,
        hasBlockedMe,
      };
    }
    if (!canViewProfile) {
      const profile = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: this.lockedProfileSelect(),
      });
      return {
        ...profile,
        posts: [],
        reposts: [],
        isPrivateLocked: true,
        isBlockedByMe,
        hasBlockedMe,
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
                profileOwner: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
                activity: { select: publicActivitySelect },
                group: { select: { id: true, name: true, slug: true, visibility: true } },
                images: { orderBy: { sortOrder: 'asc' } },
                hashtags: { include: { hashtag: true } },
                taggedUsers: { include: { user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } } }, orderBy: { createdAt: 'asc' } },
                buddySessionRecap: { select: publicBuddySessionRecapSelect },
                likes: { where: { userId: viewerId }, select: { userId: true } },
                saves: { where: { userId: viewerId }, select: { userId: true } },
                _count: { select: { reposts: true } },
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
        activity: { select: publicActivitySelect },
        images: { orderBy: { sortOrder: 'asc' } },
        hashtags: { include: { hashtag: true } },
        taggedUsers: { include: { user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } } }, orderBy: { createdAt: 'asc' } },
        buddySessionRecap: { select: publicBuddySessionRecapSelect },
        likes: { where: { userId: viewerId }, select: { userId: true } },
        saves: { where: { userId: viewerId }, select: { userId: true } },
        _count: { select: { reposts: true } },
      },
    });
    const visibleProfile = exposeProfileBadges(exposeActivityPersonas(profile));
    const reposts = (visibleProfile.reposts ?? []).map((repost: any) => ({
      ...repost,
      post: presentPublicPost(repost.post, { viewerId }),
    }));
    return {
      ...visibleProfile,
      reposts,
      posts: posts.map((post) => presentPublicPost(post, { viewerId })),
      isFollowing: Boolean(isFollowing),
      followsMe: Boolean(followsMe),
      isCloseBuddy: Boolean(isCloseBuddy),
      isPrivateLocked: false,
      isBlockedByMe,
      hasBlockedMe,
      followRequestStatus: pendingFollowRequest?.status ?? null,
    };
  }
  search(viewerId: string, q = '', options: { take?: number; cursor?: number } = {}) {
    const query = q.trim();
    const filters: Prisma.UserWhereInput[] = [
      { id: { not: viewerId } },
      { blocksSent: { none: { blockedId: viewerId } } },
      { blocksReceived: { none: { blockerId: viewerId } } },
    ];
    if (query) {
      filters.push({
        OR: [
          { displayName: { contains: query, mode: 'insensitive' } },
          { username: { contains: query.toLowerCase().replace(/^@/, ''), mode: 'insensitive' } },
        ],
      });
    }
    const take = this.listTake(options.take) ?? 25;
    const cursor = this.listCursor(options.cursor);
    return this.prisma.user.findMany({
      where: { AND: filters },
      take,
      ...(cursor ? { skip: cursor } : {}),
      orderBy: { createdAt: 'desc' },
      select: this.publicSelect(),
    }).then((users) => users.map((user) => exposeProfileBadges(exposeActivityPersonas(user))));
  }

  searchHistory(userId: string, options: { take?: number; cursor?: number } = {}) {
    const take = Math.min(Math.max(Math.trunc(options.take ?? 1000), 1), 1000);
    const cursor = this.listCursor(options.cursor);
    return this.prisma.userSearchHistory.findMany({
      where: { userId },
      take,
      ...(cursor ? { skip: cursor } : {}),
      orderBy: { updatedAt: 'desc' },
      select: this.searchHistorySelect(),
    });
  }

  async saveSearchHistory(userId: string, dto: SaveSearchHistoryDto) {
    if (dto.type === 'term') {
      const term = dto.term?.trim();
      if (!term) throw new BadRequestException('Search term is required');
      await this.prisma.userSearchHistory.deleteMany({
        where: { userId, type: 'term', term: { equals: term, mode: 'insensitive' } },
      });
      const entry = await this.prisma.userSearchHistory.create({
        data: { userId, type: 'term', term },
        select: this.searchHistorySelect(),
      });
      await this.trimSearchHistory(userId);
      return entry;
    }

    if (dto.type === 'user') {
      const targetUserId = dto.targetUserId?.trim();
      if (!targetUserId) throw new BadRequestException('Target user is required');
      const target = await this.prisma.user.findFirst({
        where: { id: targetUserId, ...visibleAuthorWhere(userId) },
        select: { id: true, displayName: true, username: true, profileImageUrl: true },
      });
      if (!target) throw new NotFoundException('User not found');
      await this.prisma.userSearchHistory.deleteMany({ where: { userId, type: 'user', targetUserId } });
      const entry = await this.prisma.userSearchHistory.create({
        data: {
          userId,
          type: 'user',
          targetUserId,
          displayName: target.displayName,
          username: target.username,
          profileImageUrl: target.profileImageUrl,
        },
        select: this.searchHistorySelect(),
      });
      await this.trimSearchHistory(userId);
      return entry;
    }

    throw new BadRequestException('Unsupported search history type');
  }

  async removeSearchHistory(userId: string, id: string) {
    await this.prisma.userSearchHistory.deleteMany({ where: { id, userId } });
    return { ok: true };
  }

  async clearSearchHistory(userId: string) {
    await this.prisma.userSearchHistory.deleteMany({ where: { userId } });
    return { ok: true };
  }

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
    await this.acceptMutualMessageRequests(userId, targetId);
    void this.notifications.create({ userId: targetId, actorId: userId, type: 'follow', entityId: userId, message: 'started following you' });
    return { status: 'following', follow };
  }
  async unfollow(userId: string, identifier: string) {
    const targetId = await this.resolveUserId(identifier);
    return this.prisma.$transaction([this.prisma.follow.deleteMany({ where: { followerId: userId, followingId: targetId } }), this.prisma.followRequest.deleteMany({ where: { requesterId: userId, recipientId: targetId, status: 'pending' } })]).then(() => ({ ok: true }));
  }
  incomingFollowRequests(userId: string) { return this.prisma.followRequest.findMany({ where: { recipientId: userId, status: 'pending' }, include: this.followRequestInclude(), orderBy: { createdAt: 'desc' } }).then((rows) => rows.map((row) => this.presentFollowRequest(row))); }
  sentFollowRequests(userId: string) { return this.prisma.followRequest.findMany({ where: { requesterId: userId, status: 'pending' }, include: this.followRequestInclude(), orderBy: { createdAt: 'desc' } }).then((rows) => rows.map((row) => this.presentFollowRequest(row))); }
  async acceptFollowRequest(userId: string, requestId: string) {
    const request = await this.prisma.followRequest.findFirst({ where: { id: requestId, recipientId: userId, status: 'pending' } });
    if (!request) throw new NotFoundException('Follow request not found');
    const follow = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.followRequest.updateMany({
        where: { id: requestId, recipientId: userId, status: 'pending' },
        data: { status: 'accepted' },
      });
      if (claimed.count !== 1) throw new NotFoundException('Follow request not found');
      return tx.follow.upsert({
        where: { followerId_followingId: { followerId: request.requesterId, followingId: userId } },
        create: { followerId: request.requesterId, followingId: userId },
        update: {},
      });
    });
    await this.acceptMutualMessageRequests(userId, request.requesterId);
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
  blockedUsers(userId: string) { return this.prisma.block.findMany({ where: { blockerId: userId }, include: { blocked: { select: this.publicSelect() } }, orderBy: { createdAt: 'desc' } }).then(rows => rows.map(r => exposeProfileBadges(exposeActivityPersonas(r.blocked)))); }
  followers(userId: string) { return this.profileFollowers(userId, userId); }
  async profileFollowers(identifier: string, viewerId?: string) {
    const userId = await this.resolveUserId(identifier);
    const effectiveViewerId = viewerId ?? userId;
    await assertCanViewProfile(this.prisma, effectiveViewerId, userId);
    return this.prisma.follow.findMany({
      where: { followingId: userId, follower: visibleAuthorWhere(effectiveViewerId) },
      include: { follower: { select: this.publicSelect() } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }).then(rows => rows.map(r => exposeProfileBadges(exposeActivityPersonas(r.follower))));
  }
  following(userId: string, nonFollowback = false) { return this.profileFollowing(userId, userId).then(users => users.filter((u: any) => nonFollowback ? !u.followsBack : true)); }
  async profileFollowing(identifier: string, viewerId?: string) {
    const userId = await this.resolveUserId(identifier);
    const effectiveViewerId = viewerId ?? userId;
    await assertCanViewProfile(this.prisma, effectiveViewerId, userId);
    return this.prisma.follow.findMany({
      where: { followerId: userId, following: visibleAuthorWhere(effectiveViewerId) },
      include: { following: { select: { ...this.publicSelect(), following: { where: { followingId: userId }, select: { followerId: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }).then(rows => rows.map(r => ({ ...exposeProfileBadges(exposeActivityPersonas(r.following)), followsBack: r.following.following.length > 0, following: undefined })));
  }
  async mutual(userId: string) { const following = await this.following(userId); return following.filter((u: any) => u.followsBack); }
  async block(userId: string, identifier: string) {
    const targetId = await this.resolveUserId(identifier);
    if (userId === targetId) throw new BadRequestException('Cannot block yourself');
    await this.prisma.$transaction(async (tx) => {
      await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
        create: { blockerId: userId, blockedId: targetId },
        update: {},
      });
      await tx.follow.deleteMany({ where: { OR: [{ followerId: userId, followingId: targetId }, { followerId: targetId, followingId: userId }] } });
      await tx.followRequest.deleteMany({ where: { OR: [{ requesterId: userId, recipientId: targetId }, { requesterId: targetId, recipientId: userId }] } });
      await tx.messageRequest.deleteMany({ where: { OR: [{ senderId: userId, recipientId: targetId }, { senderId: targetId, recipientId: userId }] } });
      await tx.closeBuddy.deleteMany({ where: { OR: [{ ownerId: userId, buddyId: targetId }, { ownerId: targetId, buddyId: userId }] } });
    });
    return { blocked: true };
  }
  async unblock(userId: string, identifier: string) {
    const targetId = await this.resolveUserId(identifier);
    return this.prisma.block.delete({ where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } } }).catch(() => null).then(() => ({ blocked: false }));
  }
  async report(userId: string, identifier: string, dto: ReportUserDto) {
    const targetId = await this.resolveUserId(identifier);
    if (userId === targetId) throw new BadRequestException('Cannot report yourself');
    const note = dto.note?.trim();
    const details = dto.details?.trim();
    const reason = dto.reason ?? 'other';
    const category = dto.category ?? this.reportCategoryFromReason(reason);
    await this.prisma.userReport.upsert({
      where: { reportedId_reporterId: { reportedId: targetId, reporterId: userId } },
      create: { reportedId: targetId, reporterId: userId, reason, category, note: note || null, details: details || null, status: 'open' },
      update: { reason, category, note: note || null, details: details || null, status: 'open', reviewedAt: null, reviewedById: null, actionTaken: null, resolutionNote: null },
    });
    return { ok: true };
  }

  private reportCategoryFromReason(reason: ReportUserDto['reason']) {
    if (reason === 'nudity') return 'sexual_content';
    return reason ?? 'other';
  }

  private async acceptMutualMessageRequests(userId: string, peerId: string) {
    const pending = await this.prisma.messageRequest.findMany({
      where: {
        status: 'pending',
        OR: [
          { senderId: userId, recipientId: peerId },
          { senderId: peerId, recipientId: userId },
        ],
      },
      select: {
        id: true,
        senderId: true,
        recipientId: true,
        body: true,
        referenceType: true,
        referenceId: true,
        referenceMediaUrl: true,
        referenceText: true,
        referenceAuthorName: true,
      },
    });
    for (const request of pending) {
      await this.prisma.$transaction(async (tx) => {
        const [followCount, blocked] = await Promise.all([
          tx.follow.count({
            where: {
              OR: [
                { followerId: userId, followingId: peerId },
                { followerId: peerId, followingId: userId },
              ],
            },
          }),
          tx.block.findFirst({
            where: {
              OR: [
                { blockerId: userId, blockedId: peerId },
                { blockerId: peerId, blockedId: userId },
              ],
            },
            select: { blockerId: true },
          }),
        ]);
        if (followCount !== 2 || blocked) return;
        const claimed = await tx.messageRequest.updateMany({
          where: { id: request.id, status: 'pending' },
          data: { status: 'accepted' },
        });
        if (claimed.count !== 1) return;
        await tx.message.create({
          data: {
            senderId: request.senderId,
            recipientId: request.recipientId,
            body: request.body,
            referenceType: request.referenceType,
            referenceId: request.referenceId,
            referenceMediaUrl: request.referenceMediaUrl,
            referenceText: request.referenceText,
            referenceAuthorName: request.referenceAuthorName,
          },
        });
      });
    }
  }

  private withOnboarding<T extends {
    id: string;
    email: string;
    displayName?: string | null;
    username?: string | null;
    usernameFinalized?: boolean | null;
    bio?: string | null;
    profileImageUrl?: string | null;
    coverImageUrl?: string | null;
    gender?: string | null;
    dateOfBirth?: Date | string | null;
    activityPersonas?: any;
    legalConsentAt?: Date | string | null;
    dataConsentAt?: Date | string | null;
    profileVisibility?: string | null;
    defaultPostVisibility?: string | null;
    betaUser?: boolean | null;
    hideProfileBadges?: boolean | null;
    hiddenProfileBadgeCodes?: string[] | null;
    badges?: any;
    verified?: boolean | null;
    chatPublicKey?: string | null;
    createdAt?: Date | string;
    _count?: Record<string, number>;
  }>(user: T) {
    const visibleUser = exposeProfileBadges(exposeActivityPersonas(user));
    return {
      id: visibleUser.id,
      email: visibleUser.email,
      displayName: visibleUser.displayName,
      username: visibleUser.username,
      usernameFinalized: visibleUser.usernameFinalized,
      bio: visibleUser.bio,
      profileImageUrl: visibleUser.profileImageUrl,
      coverImageUrl: visibleUser.coverImageUrl,
      gender: visibleUser.gender,
      dateOfBirth: visibleUser.dateOfBirth,
      activityPersona: visibleUser.activityPersona,
      activityPersonas: visibleUser.activityPersonas,
      profileVisibility: visibleUser.profileVisibility,
      defaultPostVisibility: visibleUser.defaultPostVisibility,
      hideProfileBadges: visibleUser.hideProfileBadges,
      hiddenProfileBadgeCodes: user.hiddenProfileBadgeCodes ?? [],
      badges: visibleUser.badges,
      availableProfileBadges: availableProfileBadgesFor(user),
      verified: visibleUser.verified,
      chatPublicKey: visibleUser.chatPublicKey,
      createdAt: visibleUser.createdAt,
      _count: visibleUser._count,
      onboardingComplete: Boolean(user.usernameFinalized && user.dateOfBirth && user.legalConsentAt && user.dataConsentAt),
    };
  }
  private select() { return { id: true, email: true, displayName: true, username: true, usernameFinalized: true, bio: true, profileImageUrl: true, coverImageUrl: true, gender: true, dateOfBirth: true, activityPersonas: activityPersonaLinkSelect, legalConsentAt: true, dataConsentAt: true, profileVisibility: true, defaultPostVisibility: true, betaUser: true, hideProfileBadges: true, hiddenProfileBadgeCodes: true, badges: { select: profileBadgeSelect }, verified: true, chatPublicKey: true, createdAt: true, _count: { select: { followers: true, following: true } } } as const; }
  private publicSelect() { return { id: true, displayName: true, username: true, usernameFinalized: true, bio: true, profileImageUrl: true, coverImageUrl: true, activityPersonas: activityPersonaLinkSelect, profileVisibility: true, betaUser: true, hideProfileBadges: true, hiddenProfileBadgeCodes: true, badges: { select: profileBadgeSelect }, verified: true, chatPublicKey: true, createdAt: true } as const; }
  private lockedProfileSelect() { return { id: true, displayName: true, username: true, profileImageUrl: true, verified: true, profileVisibility: true } as const; }
  private async resolveUserId(identifier: string) {
    const normalized = identifier.toLowerCase().replace(/^@/, '').trim();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: identifier }, { username: normalized }] },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user.id;
  }

  private listTake(value?: number) {
    if (!Number.isFinite(value)) return undefined;
    return Math.min(Math.max(Math.trunc(value ?? 0), 1), 50);
  }

  private listCursor(value?: number) {
    if (!Number.isFinite(value)) return undefined;
    return Math.max(Math.trunc(value ?? 0), 0);
  }

  private searchHistorySelect() {
    return {
      id: true,
      type: true,
      term: true,
      targetUserId: true,
      displayName: true,
      username: true,
      profileImageUrl: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }

  private followRequestInclude() {
    return {
      requester: { select: this.publicSelect() },
      recipient: { select: this.publicSelect() },
    } as const;
  }

  private presentFollowRequest(request: Record<string, unknown> & { requester: PublicPresentationUser; recipient: PublicPresentationUser }) {
    return {
      ...request,
      requester: exposeProfileBadges(exposeActivityPersonas(request.requester)),
      recipient: exposeProfileBadges(exposeActivityPersonas(request.recipient)),
    };
  }

  private async trimSearchHistory(userId: string) {
    const overflow = await this.prisma.userSearchHistory.findMany({
      where: { userId },
      skip: 1000,
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (overflow.length) await this.prisma.userSearchHistory.deleteMany({ where: { id: { in: overflow.map((entry) => entry.id) } } });
  }

  private async recomputeEngagementCounters(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`
      UPDATE "posts" AS "post"
      SET
        "like_count" = COALESCE((SELECT COUNT(*)::int FROM "post_likes" AS "like" WHERE "like"."post_id" = "post"."id"), 0),
        "comment_count" = COALESCE((SELECT COUNT(*)::int FROM "comments" AS "comment" WHERE "comment"."post_id" = "post"."id"), 0),
        "view_count" = COALESCE((SELECT SUM("view"."count")::int FROM "post_views" AS "view" WHERE "view"."post_id" = "post"."id"), 0)
    `;
    await tx.$executeRaw`
      UPDATE "comments" AS "comment"
      SET "like_count" = COALESCE((SELECT COUNT(*)::int FROM "comment_likes" AS "like" WHERE "like"."comment_id" = "comment"."id"), 0)
    `;
    await tx.$executeRaw`
      UPDATE "reposts" AS "repost"
      SET "like_count" = COALESCE((SELECT COUNT(*)::int FROM "repost_likes" AS "like" WHERE "like"."repost_id" = "repost"."id"), 0)
    `;
  }
}
