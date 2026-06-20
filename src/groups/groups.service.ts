import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { GroupReportReason, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGroupChannelDto, CreateGroupDto, GroupChatMuteDto, GroupMessageDto, GroupPostDto, InviteGroupUsersDto, ReportGroupDto, UpdateGroupSettingsDto } from './dto';

type TrendingStats = { salutes: number; comments: number; reports: number };
type GroupListOptions = { take?: number; cursor?: number; discoverOnly?: boolean };
type GroupGetOptions = { summaryOnly?: boolean };
type GroupChatReadStateWithUser = {
  userId: string;
  lastReadAt: Date;
  user: { id: string; displayName: string | null; username: string | null; profileImageUrl: string | null };
};
const DEFAULT_GROUP_CHANNEL_NAME = 'main';
const DEFAULT_GROUP_CHANNEL_DESCRIPTION = 'Main channel';

function isPrismaUniqueError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}

@Injectable()
export class GroupsService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  async create(userId: string, dto: CreateGroupDto) {
    try {
      const group = await this.prisma.group.create({
        data: {
          name: dto.name.trim(),
          slug: dto.slug.toLowerCase(),
          description: dto.description?.trim(),
          visibility: dto.visibility ?? 'public',
          inviteCode: randomBytes(6).toString('hex'),
          members: { create: { userId, role: 'owner' } },
          chatChannels: { create: { name: DEFAULT_GROUP_CHANNEL_NAME, description: DEFAULT_GROUP_CHANNEL_DESCRIPTION, creatorId: userId } },
        },
        include: this.include(true),
      });
      if (dto.inviteUserIds?.length) await this.createPendingInvites(userId, group.id, group.name, dto.inviteUserIds, { throwIfEmpty: false });
      return { ...group, isMember: true, capabilities: this.capabilities('owner') };
    } catch (error) {
      if (isPrismaUniqueError(error)) throw new ConflictException('Group slug is already taken.');
      throw error;
    }
  }

  async list(userId?: string, options: GroupListOptions = {}) {
    const take = this.listTake(options.take);
    const cursor = this.listCursor(options.cursor);
    const where: Prisma.GroupWhereInput = options.discoverOnly && userId
      ? { visibility: 'public', members: { none: { userId } } }
      : { OR: [{ visibility: 'public' }, ...(userId ? [{ members: { some: { userId } } }] : [])] };
    const groups = await this.prisma.group.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...(take ? { take } : {}),
      ...(cursor ? { skip: cursor } : {}),
      include: this.include(Boolean(userId)),
    });
    const [unreadByGroup, mutedGroupIds, pinnedGroupIds] = userId
      ? await Promise.all([this.unreadCountByGroup(userId), this.mutedGroupIds(userId), this.pinnedGroupIds(userId)])
      : [new Map<string, number>(), new Set<string>(), new Set<string>()] as const;
    return this.sortGroupsByActivity(groups.map((group) => {
      const { members, messages, ...summary } = group;
      return {
        ...summary,
        isMember: userId ? members.some((member) => member.userId === userId) : false,
        lastMessage: messages[0] ?? null,
        unreadCount: mutedGroupIds.has(group.id) ? 0 : unreadByGroup.get(group.id) ?? 0,
        muted: mutedGroupIds.has(group.id),
        pinned: pinnedGroupIds.has(group.id),
      };
    }));
  }

  async mine(userId: string, options: GroupListOptions = {}) {
    const take = this.listTake(options.take);
    const cursor = this.listCursor(options.cursor);
    const [groups, unreadByGroup, mutedGroupIds, pinnedGroupIds] = await Promise.all([
      this.prisma.group.findMany({
      where: { members: { some: { userId } } },
      orderBy: { createdAt: 'desc' },
      ...(take ? { take } : {}),
      ...(cursor ? { skip: cursor } : {}),
      include: this.include(true),
      }),
      this.unreadCountByGroup(userId),
      this.mutedGroupIds(userId),
      this.pinnedGroupIds(userId),
    ]);
    return this.sortGroupsByActivity(groups.map((group) => {
      const { members, messages, ...summary } = group;
      const role = members.find((member) => member.userId === userId)?.role;
      return {
        ...summary,
        isMember: true,
        capabilities: this.capabilities(role),
        lastMessage: messages[0] ?? null,
        unreadCount: mutedGroupIds.has(group.id) ? 0 : unreadByGroup.get(group.id) ?? 0,
        muted: mutedGroupIds.has(group.id),
        pinned: pinnedGroupIds.has(group.id),
      };
    }));
  }

  async get(userId: string, slug: string, options: GroupGetOptions = {}) {
    if (options.summaryOnly) return this.getSummary(userId, slug);
    const group = await this.prisma.group.findUniqueOrThrow({ where: { slug }, include: this.include(true) });
    const isMember = group.members.some((member) => member.userId === userId);
    if (group.visibility === 'private' && !isMember) throw new ForbiddenException('Join this private group by invite first');
    const [muted, pinned] = isMember ? await Promise.all([this.isGroupMuted(userId, group.id), this.isGroupPinned(userId, group.id)]) : [false, false];
    return { ...group, isMember, capabilities: this.capabilities(group.members.find((member) => member.userId === userId)?.role), muted, pinned };
  }

  private async getSummary(userId: string, slug: string) {
    const group = await this.prisma.group.findUniqueOrThrow({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        visibility: true,
        profileImageUrl: true,
        members: {
          where: { userId },
          take: 1,
          select: { userId: true, role: true },
        },
        _count: { select: { members: true, messages: true, posts: true, chatChannels: true } },
      },
    });
    const member = group.members[0];
    if (group.visibility === 'private' && !member) throw new ForbiddenException('Join this private group by invite first');
    return {
      id: group.id,
      name: group.name,
      slug: group.slug,
      visibility: group.visibility,
      profileImageUrl: group.profileImageUrl,
      _count: group._count,
      isMember: Boolean(member),
      capabilities: this.capabilities(member?.role),
    };
  }

  async join(userId: string, groupId: string) {
    await this.prisma.groupMember.upsert({ where: { groupId_userId: { groupId, userId } }, create: { groupId, userId }, update: {} });
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { slug: true } });
    return this.get(userId, group.slug);
  }

  async joinByInvite(userId: string, inviteCode: string) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { inviteCode } });
    await this.join(userId, group.id);
    return this.get(userId, group.slug);
  }

  async invitations(userId: string) {
    return this.prisma.groupInvite.findMany({
      where: { inviteeId: userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: {
        inviter: { select: this.publicUserSelect() },
        group: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            profileImageUrl: true,
            coverImageUrl: true,
            visibility: true,
            _count: { select: { members: true, posts: true } },
          },
        },
      },
    });
  }

  async inviteCandidates(userId: string, groupId: string, q = '') {
    await this.ensureMember(userId, groupId);
    return this.prisma.user.findMany({
      where: this.inviteCandidateWhere(userId, groupId, q),
      orderBy: [{ displayName: 'asc' }, { username: 'asc' }],
      take: 20,
      select: this.publicUserSelect(),
    });
  }

  async inviteUsers(userId: string, groupId: string, dto: InviteGroupUsersDto) {
    const group = await this.prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      select: { id: true, name: true, members: { where: { userId }, take: 1, select: { userId: true } } },
    });
    if (!group.members.length) throw new ForbiddenException('Join the group first');
    return this.createPendingInvites(userId, group.id, group.name, dto.userIds, { throwIfEmpty: true });
  }

  async acceptInvite(userId: string, inviteId: string) {
    const invite = await this.prisma.groupInvite.findFirst({
      where: { id: inviteId, inviteeId: userId, status: 'pending' },
      include: { group: { select: { id: true, name: true, slug: true } } },
    });
    if (!invite) throw new BadRequestException('This group invite is no longer available.');
    await this.prisma.$transaction([
      this.prisma.groupInvite.update({ where: { id: invite.id }, data: { status: 'accepted', respondedAt: new Date() } }),
      this.prisma.groupMember.upsert({ where: { groupId_userId: { groupId: invite.groupId, userId } }, create: { groupId: invite.groupId, userId }, update: {} }),
      this.prisma.notification.updateMany({ where: { userId, type: 'group_invite', entityId: invite.id }, data: { readAt: new Date() } }),
    ]);
    void this.notifications.create({ userId: invite.inviterId, actorId: userId, type: 'group_join', entityId: invite.groupId, message: `accepted your invite to ${invite.group.name}` });
    return this.get(userId, invite.group.slug);
  }

  async declineInvite(userId: string, inviteId: string) {
    const result = await this.prisma.groupInvite.updateMany({
      where: { id: inviteId, inviteeId: userId, status: 'pending' },
      data: { status: 'declined', respondedAt: new Date() },
    });
    if (!result.count) throw new BadRequestException('This group invite is no longer available.');
    await this.prisma.notification.updateMany({ where: { userId, type: 'group_invite', entityId: inviteId }, data: { readAt: new Date() } });
    return { ok: true };
  }


  async updateSettings(userId: string, groupId: string, dto: UpdateGroupSettingsDto) {
    const role = await this.memberRole(userId, groupId);
    if (!this.canManage(role)) throw new ForbiddenException('Only group owners and admins can update settings');
    const group = await this.prisma.group.update({
      where: { id: groupId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(dto.profileImageUrl !== undefined ? { profileImageUrl: dto.profileImageUrl.trim() || null } : {}),
        ...(dto.coverImageUrl !== undefined ? { coverImageUrl: dto.coverImageUrl.trim() || null } : {}),
        ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
        ...(dto.allowAnonymousPosts !== undefined ? { allowAnonymousPosts: dto.allowAnonymousPosts } : {}),
      },
      include: this.include(true),
    });
    return { ...group, isMember: true, capabilities: this.capabilities(role) };
  }

  async report(userId: string, groupId: string, dto: ReportGroupDto) {
    await this.ensureCanView(userId, groupId);
    const reason = dto.reason ?? GroupReportReason.other;
    const category = dto.category ?? this.reportCategoryFromReason(reason);
    const note = dto.note?.trim() || null;
    const details = dto.details?.trim() || null;
    await this.prisma.groupReport.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId, reason, category, note, details, status: 'open' },
      update: { reason, category, note, details, status: 'open', reviewedAt: null, reviewedById: null, actionTaken: null, resolutionNote: null },
    });
    return { ok: true };
  }

  async updateRole(userId: string, groupId: string, memberId: string, nextRole: 'owner' | 'admin' | 'moderator' | 'member') {
    const role = await this.memberRole(userId, groupId);
    if (!this.canManage(role)) throw new ForbiddenException('Only group owners and admins can update roles');
    if ((nextRole === 'owner' || role === 'admin') && role !== 'owner') throw new ForbiddenException('Only owners can assign owners or change admin roles');
    if (memberId === userId && role === 'owner' && nextRole !== 'owner') throw new ForbiddenException('Owners cannot demote themselves');
    await this.prisma.groupMember.update({ where: { groupId_userId: { groupId, userId: memberId } }, data: { role: nextRole } });
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, include: this.include(true) });
    return { ...group, isMember: true, capabilities: this.capabilities(role) };
  }

  async posts(userId: string, groupId: string, filters: { sort?: 'latest' | 'trending' | 'most-commented' | 'oldest'; hashtag?: string; q?: string; mine?: boolean; take?: number; cursor?: number; timezone?: string } = {}) {
    await this.ensureCanView(userId, groupId);
    const hashtags = this.normalizeHashtags(filters.hashtag);
    const q = filters.q?.trim();
    const take = Math.min(filters.take ?? 10, 50);
    const cursor = filters.cursor ?? 0;
    const where = {
      groupId,
      ...(filters.mine ? { authorId: userId } : {}),
      ...(hashtags.length ? { AND: hashtags.map((name) => ({ hashtags: { some: { hashtag: { name } } } })) } : {}),
      ...(q ? { text: { contains: q, mode: 'insensitive' as const } } : {}),
    };
    if (filters.sort === 'trending') {
      const posts = await this.prisma.post.findMany({ where, take: 500, orderBy: { createdAt: 'desc' }, include: this.postInclude() });
      const stats = await this.trendingStats(posts.map((post) => post.id), filters.timezone);
      return posts
        .sort((a, b) => this.trendingScore(b, stats.get(b.id)) - this.trendingScore(a, stats.get(a.id)) || b.createdAt.getTime() - a.createdAt.getTime())
        .slice(cursor, cursor + take)
        .map((post) => this.presentPost(post));
    }
    const posts = await this.prisma.post.findMany({
      skip: cursor,
      take,
      where,
      orderBy: this.postOrderBy(filters.sort),
      include: this.postInclude(),
    });
    return posts.map((post) => this.presentPost(post));
  }

  async createPost(userId: string, groupId: string, dto: GroupPostDto) {
    await this.ensureMember(userId, groupId);
    const text = dto.text?.trim() ?? '';
    const images = dto.images ?? [];
    if (!text && !images.length) throw new BadRequestException('Post needs text or at least one image');
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { allowAnonymousPosts: true } });
    const isAnonymous = Boolean(dto.anonymous && group.allowAnonymousPosts);
    const post = await this.prisma.post.create({
      data: {
        groupId,
        authorId: userId,
        isAnonymous,
        text: text || null,
        images: { create: images.map((image, sortOrder) => ({
          url: image.url,
          alt: image.alt,
          filename: image.filename,
          mediaType: image.mediaType ?? image.type ?? 'image',
          mimeType: image.mimeType,
          size: image.size ? Math.round(image.size) : undefined,
          width: image.width ? Math.round(image.width) : undefined,
          height: image.height ? Math.round(image.height) : undefined,
          sortOrder,
        })) },
        hashtags: { create: this.extractHashtags(text).map((name) => ({ hashtag: { connectOrCreate: { where: { name }, create: { name } } } })) },
      },
      include: this.postInclude(),
    });
    return this.presentPost(post);
  }

  async removePost(userId: string, groupId: string, postId: string) {
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id: postId }, select: { authorId: true, groupId: true } });
    if (post.groupId !== groupId) throw new ForbiddenException();
    const role = await this.memberRole(userId, groupId);
    if (post.authorId !== userId && !this.canModerate(role)) throw new ForbiddenException('Only the author or group moderators can delete this group post');
    await this.prisma.post.delete({ where: { id: postId } });
  }

  async channels(userId: string, groupId: string) {
    await this.ensureMember(userId, groupId);
    await this.ensureDefaultChannel(groupId, userId);
    const role = await this.memberRole(userId, groupId);
    const [channels, unreadByChannel, mutedChannelIds, groupMuted, pinnedChannelIds] = await Promise.all([
      this.prisma.groupChatChannel.findMany({
        where: {
          groupId,
          OR: [
            { visibility: 'public' },
            ...(this.canManage(role) ? [{ visibility: 'private' as const }] : []),
            { allowedUsers: { some: { userId } } },
          ],
        },
        orderBy: [{ name: 'asc' }],
        include: this.channelInclude(),
      }),
      this.unreadCountByChannel(userId, groupId),
      this.mutedChannelIds(userId, groupId),
      this.isGroupMuted(userId, groupId),
      this.pinnedChannelIds(userId, groupId),
    ]);
    return this.sortDefaultChannelFirst(channels).map((channel) => ({
      ...channel,
      muted: groupMuted || mutedChannelIds.has(channel.id),
      unreadCount: groupMuted || mutedChannelIds.has(channel.id) ? 0 : unreadByChannel.get(channel.id) ?? 0,
      pinned: pinnedChannelIds.has(channel.id),
    })).sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || (left.name === DEFAULT_GROUP_CHANNEL_NAME ? -1 : right.name === DEFAULT_GROUP_CHANNEL_NAME ? 1 : 0));
  }

  async setGroupMute(userId: string, groupId: string, dto: GroupChatMuteDto) {
    const muted = dto.muted;
    await this.ensureMember(userId, groupId);
    if (muted) {
      const mutedUntil = this.parseMuteUntil(dto.mutedUntil);
      await this.prisma.groupChatMute.upsert({
        where: { userId_groupId: { userId, groupId } },
        create: { userId, groupId, mutedUntil },
        update: { mutedUntil },
      });
    } else {
      await this.prisma.groupChatMute.deleteMany({ where: { userId, groupId } });
    }
    return { groupId, muted, mutedUntil: muted ? this.parseMuteUntil(dto.mutedUntil) : null };
  }

  async setGroupPin(userId: string, groupId: string, pinned: boolean) {
    await this.ensureMember(userId, groupId);
    if (pinned) await this.prisma.groupChatPin.upsert({ where: { userId_groupId: { userId, groupId } }, create: { userId, groupId }, update: {} });
    else await this.prisma.groupChatPin.deleteMany({ where: { userId, groupId } });
    return { groupId, pinned };
  }

  async setChannelMute(userId: string, groupId: string, channelId: string, dto: GroupChatMuteDto) {
    const muted = dto.muted;
    await this.ensureMember(userId, groupId);
    await this.ensureChannelAccess(userId, groupId, channelId);
    if (muted) {
      const mutedUntil = this.parseMuteUntil(dto.mutedUntil);
      await this.prisma.groupChatChannelMute.upsert({
        where: { userId_channelId: { userId, channelId } },
        create: { userId, groupId, channelId, mutedUntil },
        update: { groupId, mutedUntil },
      });
    } else {
      await this.prisma.groupChatChannelMute.deleteMany({ where: { userId, channelId } });
    }
    return { groupId, channelId, muted, mutedUntil: muted ? this.parseMuteUntil(dto.mutedUntil) : null };
  }

  async setChannelPin(userId: string, groupId: string, channelId: string, pinned: boolean) {
    await this.ensureMember(userId, groupId);
    await this.ensureChannelAccess(userId, groupId, channelId);
    if (pinned) await this.prisma.groupChatChannelPin.upsert({ where: { userId_channelId: { userId, channelId } }, create: { userId, groupId, channelId }, update: { groupId } });
    else await this.prisma.groupChatChannelPin.deleteMany({ where: { userId, channelId } });
    return { groupId, channelId, pinned };
  }

  async createChannel(userId: string, groupId: string, dto: CreateGroupChannelDto) {
    const role = await this.memberRole(userId, groupId);
    if (!this.canModerate(role)) throw new ForbiddenException('Only group owners, admins, and moderators can create chat channels');
    const name = this.normalizeChannelName(dto.name);
    const visibility = dto.visibility ?? 'public';
    const memberIds = visibility === 'private' ? await this.validGroupMemberIds(groupId, [...(dto.memberIds ?? []), userId]) : [];
    return this.prisma.groupChatChannel.create({
      data: {
        groupId,
        creatorId: userId,
        name,
        description: dto.description?.trim() || null,
        visibility,
        messagePolicy: dto.messagePolicy ?? 'everyone',
        ...(memberIds.length ? { allowedUsers: { create: memberIds.map((memberId) => ({ userId: memberId })) } } : {}),
      },
      include: this.channelInclude(),
    });
  }

  async messages(userId: string, groupId: string, channelId?: string) {
    await this.ensureMember(userId, groupId);
    const channel = channelId ? await this.ensureChannelAccess(userId, groupId, channelId) : await this.defaultChannel(groupId, userId);
    await this.markChannelRead(userId, groupId, channel.id);
    const [messages, readStates] = await Promise.all([
      this.prisma.message.findMany({ where: { groupId, channelId: channel.id, hiddenBy: { none: { userId } } }, orderBy: { createdAt: 'asc' }, include: this.messageInclude() }),
      this.channelReadStates(channel.id),
    ]);
    const pinned = await this.withPinnedMessageFlags(userId, messages);
    return pinned.map((message) => this.withReadBy(message, readStates));
  }

  async sendMessage(userId: string, groupId: string, channelId: string | undefined, dto: GroupMessageDto) {
    await this.ensureMember(userId, groupId);
    const channel = channelId ? await this.ensureChannelAccess(userId, groupId, channelId) : await this.defaultChannel(groupId, userId);
    if (channel.messagePolicy === 'admins') {
      const role = await this.memberRole(userId, groupId);
      if (!this.canManage(role)) throw new ForbiddenException('Only group owners and admins can post in this channel');
    }
    if (channel.messagePolicy === 'moderators') {
      const role = await this.memberRole(userId, groupId);
      if (!this.canModerate(role)) throw new ForbiddenException('Only group owners, admins, and moderators can post in this channel');
    }
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Message cannot be empty');
    const referenceData = await this.messageReferenceData(groupId, channel.id, dto);
    const message = await this.prisma.message.create({ data: { senderId: userId, groupId, channelId: channel.id, body, ...referenceData }, include: this.messageInclude() });
    return this.withReadBy(message, []);
  }

  async messageRecipients(groupId: string, channelId: string) {
    const channel = await this.prisma.groupChatChannel.findUniqueOrThrow({
      where: { id: channelId },
      select: { groupId: true, visibility: true },
    });
    if (channel.groupId !== groupId) throw new ForbiddenException();
    if (channel.visibility !== 'private') {
      const members = await this.prisma.groupMember.findMany({ where: { groupId }, select: { userId: true } });
      return members.map((member) => member.userId);
    }
    const [managers, allowed] = await Promise.all([
      this.prisma.groupMember.findMany({ where: { groupId, role: { in: ['owner', 'admin'] } }, select: { userId: true } }),
      this.prisma.groupChatChannelMember.findMany({ where: { channelId }, select: { userId: true } }),
    ]);
    return [...new Set([...managers.map((member) => member.userId), ...allowed.map((member) => member.userId)])];
  }

  private async createPendingInvites(userId: string, groupId: string, groupName: string, userIds: string[], options: { throwIfEmpty: boolean }) {
    const recipientIds = [...new Set(userIds.filter((id) => id && id !== userId))];
    if (!recipientIds.length) {
      if (options.throwIfEmpty) throw new BadRequestException('Choose at least one user to invite.');
      return { sent: 0, recipients: [] };
    }
    const recipients = await this.prisma.user.findMany({
      where: this.inviteCandidateWhere(userId, groupId, '', recipientIds),
      select: this.publicUserSelect(),
      take: 50,
    });
    if (!recipients.length) {
      if (options.throwIfEmpty) throw new BadRequestException('No selected users can be invited to this group.');
      return { sent: 0, recipients: [] };
    }
    const invited = [];
    const now = new Date();
    for (const recipient of recipients) {
      const invite = await this.prisma.groupInvite.upsert({
        where: { groupId_inviteeId: { groupId, inviteeId: recipient.id } },
        create: { groupId, inviterId: userId, inviteeId: recipient.id },
        update: { inviterId: userId, status: 'pending', respondedAt: null, createdAt: now },
      });
      invited.push({ ...invite, invitee: recipient });
      void this.notifications.create({ userId: recipient.id, actorId: userId, type: 'group_invite', entityId: invite.id, message: `invited you to join ${groupName}` });
    }
    return { sent: invited.length, recipients: invited.map((invite) => invite.invitee) };
  }

  private inviteCandidateWhere(userId: string, groupId: string, q = '', userIds?: string[]) {
    const term = q.trim();
    const where: Prisma.UserWhereInput = {
      id: userIds?.length ? { in: userIds.filter((id) => id !== userId) } : { not: userId },
      moderationStatus: 'active',
      groupMembers: { none: { groupId } },
      groupInvitesReceived: { none: { groupId, status: 'pending' } },
      blocksSent: { none: { blockedId: userId } },
      blocksReceived: { none: { blockerId: userId } },
    };
    if (term) {
      where.OR = [
        { displayName: { contains: term, mode: 'insensitive' } },
        { username: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private publicUserSelect() {
    return { id: true, displayName: true, username: true, profileImageUrl: true } as const;
  }

  private async memberRole(userId: string, groupId: string) {
    return (await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } }, select: { role: true } }))?.role;
  }

  private canManage(role?: string) { return role === 'owner' || role === 'admin'; }
  private canModerate(role?: string) { return role === 'owner' || role === 'admin' || role === 'moderator'; }
  private capabilities(role?: string) {
    return {
      manageSettings: this.canManage(role),
      manageRoles: this.canManage(role),
      moderatePosts: this.canModerate(role),
      createChannels: this.canModerate(role),
      createPosts: Boolean(role),
    };
  }

  private sortGroupsByActivity<T extends { createdAt?: Date; lastMessage?: { createdAt: Date } | null; pinned?: boolean }>(groups: T[]) {
    return [...groups].sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || this.groupActivityTime(right) - this.groupActivityTime(left));
  }

  private listTake(value?: number) {
    if (!Number.isFinite(value)) return undefined;
    return Math.min(Math.max(Math.trunc(value ?? 0), 1), 50);
  }

  private listCursor(value?: number) {
    if (!Number.isFinite(value)) return undefined;
    return Math.max(Math.trunc(value ?? 0), 0);
  }

  private groupActivityTime(group: { createdAt?: Date; lastMessage?: { createdAt: Date } | null }) {
    return (group.lastMessage?.createdAt ?? group.createdAt ?? new Date(0)).getTime();
  }

  async markChannelRead(userId: string, groupId: string, channelId: string) {
    await this.ensureMember(userId, groupId);
    await this.ensureChannelAccess(userId, groupId, channelId);
    const readAt = new Date();
    const state = await this.prisma.groupChatReadState.upsert({
      where: { userId_channelId: { userId, channelId } },
      create: { userId, groupId, channelId, lastReadAt: readAt },
      update: { groupId, lastReadAt: readAt },
      include: { user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } } },
    });
    return { groupId, channelId, userId, readAt: state.lastReadAt, user: state.user };
  }

  private async unreadCountByGroup(userId: string) {
    const rows = await this.prisma.$queryRaw<{ groupId: string; count: bigint }[]>(Prisma.sql`
      SELECT message."group_id" AS "groupId", COUNT(*)::bigint AS count
      FROM "messages" AS message
      INNER JOIN "group_members" AS member
        ON member."group_id" = message."group_id"
        AND member."user_id" = ${userId}
      LEFT JOIN "group_chat_channels" AS channel
        ON channel."id" = message."channel_id"
      LEFT JOIN "group_chat_channel_members" AS channel_member
        ON channel_member."channel_id" = message."channel_id"
        AND channel_member."user_id" = ${userId}
      LEFT JOIN "group_chat_read_states" AS read_state
        ON read_state."user_id" = ${userId}
        AND read_state."channel_id" = message."channel_id"
      LEFT JOIN "group_chat_mutes" AS group_mute
        ON group_mute."user_id" = ${userId}
        AND group_mute."group_id" = message."group_id"
      LEFT JOIN "group_chat_channel_mutes" AS channel_mute
        ON channel_mute."user_id" = ${userId}
        AND channel_mute."channel_id" = message."channel_id"
      WHERE message."group_id" IS NOT NULL
        AND (group_mute."user_id" IS NULL OR group_mute."muted_until" <= NOW())
        AND (channel_mute."user_id" IS NULL OR channel_mute."muted_until" <= NOW())
        AND message."sender_id" <> ${userId}
        AND message."created_at" > COALESCE(read_state."last_read_at", member."joined_at")
        AND NOT EXISTS (
          SELECT 1 FROM "hidden_messages" AS hidden
          WHERE hidden."message_id" = message."id"
            AND hidden."user_id" = ${userId}
        )
        AND (
          channel."id" IS NULL
          OR channel."visibility" = 'public'::group_chat_channel_visibility
          OR member."role" IN ('owner'::group_role, 'admin'::group_role)
          OR channel_member."user_id" IS NOT NULL
        )
      GROUP BY message."group_id"
    `);
    return new Map(rows.map((row) => [row.groupId, Number(row.count)]));
  }

  private async unreadCountByChannel(userId: string, groupId: string) {
    const rows = await this.prisma.$queryRaw<{ channelId: string; count: bigint }[]>(Prisma.sql`
      SELECT message."channel_id" AS "channelId", COUNT(*)::bigint AS count
      FROM "messages" AS message
      INNER JOIN "group_members" AS member
        ON member."group_id" = message."group_id"
        AND member."user_id" = ${userId}
      LEFT JOIN "group_chat_channels" AS channel
        ON channel."id" = message."channel_id"
      LEFT JOIN "group_chat_channel_members" AS channel_member
        ON channel_member."channel_id" = message."channel_id"
        AND channel_member."user_id" = ${userId}
      LEFT JOIN "group_chat_read_states" AS read_state
        ON read_state."user_id" = ${userId}
        AND read_state."channel_id" = message."channel_id"
      LEFT JOIN "group_chat_mutes" AS group_mute
        ON group_mute."user_id" = ${userId}
        AND group_mute."group_id" = message."group_id"
      LEFT JOIN "group_chat_channel_mutes" AS channel_mute
        ON channel_mute."user_id" = ${userId}
        AND channel_mute."channel_id" = message."channel_id"
      WHERE message."group_id" = ${groupId}
        AND message."channel_id" IS NOT NULL
        AND (group_mute."user_id" IS NULL OR group_mute."muted_until" <= NOW())
        AND (channel_mute."user_id" IS NULL OR channel_mute."muted_until" <= NOW())
        AND message."sender_id" <> ${userId}
        AND message."created_at" > COALESCE(read_state."last_read_at", member."joined_at")
        AND NOT EXISTS (
          SELECT 1 FROM "hidden_messages" AS hidden
          WHERE hidden."message_id" = message."id"
            AND hidden."user_id" = ${userId}
        )
        AND (
          channel."id" IS NULL
          OR channel."visibility" = 'public'::group_chat_channel_visibility
          OR member."role" IN ('owner'::group_role, 'admin'::group_role)
          OR channel_member."user_id" IS NOT NULL
        )
      GROUP BY message."channel_id"
    `);
    return new Map(rows.map((row) => [row.channelId, Number(row.count)]));
  }

  private presentPost(post: any) {
    const { _count, ...presented } = post ?? {};
    const withRepostCount = { ...presented, repostCount: _count?.reposts ?? 0 };
    if (!withRepostCount?.isAnonymous) return withRepostCount;
    return { ...withRepostCount, author: null, anonymous: true };
  }

  private async ensureCanView(userId: string, groupId: string) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { visibility: true, members: { where: { userId }, select: { userId: true } } } });
    if (group.visibility === 'private' && group.members.length === 0) throw new ForbiddenException('Join this private group by invite first');
  }

  private async mutedGroupIds(userId: string) {
    const mutes = await this.prisma.groupChatMute.findMany({ where: this.activeMuteWhere(userId), select: { groupId: true } });
    return new Set(mutes.map((mute) => mute.groupId));
  }

  private async mutedChannelIds(userId: string, groupId: string) {
    const mutes = await this.prisma.groupChatChannelMute.findMany({ where: { ...this.activeMuteWhere(userId), groupId }, select: { channelId: true } });
    return new Set(mutes.map((mute) => mute.channelId));
  }

  private async isGroupMuted(userId: string, groupId: string) {
    return Boolean(await this.prisma.groupChatMute.findFirst({ where: { ...this.activeMuteWhere(userId), groupId }, select: { userId: true } }));
  }

  private async pinnedGroupIds(userId: string) {
    const pins = await (this.prisma.groupChatPin?.findMany({ where: { userId }, select: { groupId: true } }) ?? Promise.resolve([]));
    return new Set(pins.map((pin) => pin.groupId));
  }

  private async pinnedChannelIds(userId: string, groupId: string) {
    const pins = await (this.prisma.groupChatChannelPin?.findMany({ where: { userId, groupId }, select: { channelId: true } }) ?? Promise.resolve([]));
    return new Set(pins.map((pin) => pin.channelId));
  }

  private async isGroupPinned(userId: string, groupId: string) {
    return Boolean(await this.prisma.groupChatPin.findUnique({ where: { userId_groupId: { userId, groupId } }, select: { userId: true } }));
  }

  private activeMuteWhere(userId: string) {
    return { userId, OR: [{ mutedUntil: null }, { mutedUntil: { gt: new Date() } }] };
  }

  private parseMuteUntil(value?: string) {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new BadRequestException('Mute expiration must be in the future');
    return date;
  }

  private async ensureMember(userId: string, groupId: string) {
    const member = await this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!member) throw new ForbiddenException('Join the group first');
  }

  private reportCategoryFromReason(reason: GroupReportReason) {
    if (reason === GroupReportReason.nudity) return 'sexual_content';
    return reason;
  }

  private normalizeChannelName(name: string) {
    const normalized = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!normalized) throw new BadRequestException('Channel name is required');
    return normalized;
  }

  private async defaultChannel(groupId: string, userId: string) {
    const [channel] = await this.ensureDefaultChannel(groupId, userId);
    return channel;
  }

  private sortDefaultChannelFirst<T extends { id: string; name: string; createdAt: Date }>(channels: T[]) {
    return [...channels].sort((a, b) => {
      if (a.name === DEFAULT_GROUP_CHANNEL_NAME) return -1;
      if (b.name === DEFAULT_GROUP_CHANNEL_NAME) return 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  private async ensureDefaultChannel(groupId: string, userId: string) {
    const channels = await this.prisma.groupChatChannel.findMany({
      where: { groupId },
      orderBy: { createdAt: 'asc' },
      include: this.channelInclude(),
    });
    const mainChannel = channels.find((channel) => channel.name === DEFAULT_GROUP_CHANNEL_NAME);
    if (mainChannel) return this.sortDefaultChannelFirst(channels);
    const legacyDefault = channels.find((channel) => channel.name === 'general');
    if (legacyDefault) {
      const channel = await this.prisma.groupChatChannel.update({
        where: { id: legacyDefault.id },
        data: { name: DEFAULT_GROUP_CHANNEL_NAME, description: legacyDefault.description || DEFAULT_GROUP_CHANNEL_DESCRIPTION },
        include: this.channelInclude(),
      });
      return [channel, ...channels.filter((item) => item.id !== legacyDefault.id)];
    }
    if (channels.length) return channels;
    const channel = await this.prisma.groupChatChannel.create({
      data: { groupId, creatorId: userId, name: DEFAULT_GROUP_CHANNEL_NAME, description: DEFAULT_GROUP_CHANNEL_DESCRIPTION },
      include: this.channelInclude(),
    });
    await this.prisma.message.updateMany({ where: { groupId, channelId: null }, data: { channelId: channel.id } });
    return [channel];
  }

  private async ensureChannelAccess(userId: string, groupId: string, channelId: string) {
    const channel = await this.prisma.groupChatChannel.findUniqueOrThrow({
      where: { id: channelId },
      select: { id: true, groupId: true, visibility: true, messagePolicy: true, allowedUsers: { where: { userId }, select: { userId: true } } },
    });
    if (channel.groupId !== groupId) throw new ForbiddenException();
    if (channel.visibility === 'private') {
      const role = await this.memberRole(userId, groupId);
      if (!this.canManage(role) && channel.allowedUsers.length === 0) throw new ForbiddenException('This private channel is invite-only');
    }
    return channel;
  }

  private async validGroupMemberIds(groupId: string, memberIds: string[]) {
    const uniqueIds = [...new Set(memberIds.filter(Boolean))];
    if (!uniqueIds.length) return [];
    const members = await this.prisma.groupMember.findMany({
      where: { groupId, userId: { in: uniqueIds } },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }

  private messageInclude() {
    return { sender: { select: { id: true, displayName: true, username: true, profileImageUrl: true } }, channel: true, reactions: true } as const;
  }

  private async channelReadStates(channelId: string) {
    return this.prisma.groupChatReadState.findMany({
      where: { channelId },
      include: { user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } } },
    });
  }

  private withReadBy<T extends { senderId: string; createdAt: Date }>(message: T, readStates: GroupChatReadStateWithUser[]) {
    return {
      ...message,
      readBy: readStates
        .filter((state) => state.userId !== message.senderId && state.lastReadAt.getTime() >= message.createdAt.getTime())
        .map((state) => ({ userId: state.userId, readAt: state.lastReadAt, user: state.user })),
    };
  }

  private async withPinnedMessageFlags<T extends { id: string }>(userId: string, messages: T[]) {
    if (!messages.length) return messages;
    const pins = await this.prisma.pinnedMessage.findMany({ where: { userId, messageId: { in: messages.map((message) => message.id) } }, select: { messageId: true } });
    const pinnedIds = new Set(pins.map((pin) => pin.messageId));
    return messages.map((message) => ({ ...message, pinned: pinnedIds.has(message.id) }));
  }

  private async messageReferenceData(groupId: string, channelId: string, dto: GroupMessageDto) {
    if (dto.referenceType !== 'message' || !dto.referenceId) return {};
    const target = await this.prisma.message.findUniqueOrThrow({
      where: { id: dto.referenceId },
      select: { groupId: true, channelId: true },
    });
    if (target.groupId !== groupId || target.channelId !== channelId) throw new BadRequestException('Reply target is not in this channel.');
    return {
      referenceType: dto.referenceType,
      referenceId: dto.referenceId.trim(),
      referenceText: dto.referenceText?.trim() || undefined,
      referenceAuthorName: dto.referenceAuthorName?.trim() || undefined,
    };
  }

  private channelInclude() {
    return { creator: { select: { id: true, displayName: true, username: true, profileImageUrl: true } }, allowedUsers: { select: { userId: true } }, _count: { select: { messages: true } } } as const;
  }


  private trendingScore(post: { createdAt: Date }, stats: TrendingStats = { salutes: 0, comments: 0, reports: 0 }) {
    const ageHours = Math.max((Date.now() - post.createdAt.getTime()) / 36e5, 0.1);
    const engagement = stats.salutes * 2 + stats.comments * 4 - stats.reports * 8;
    return (Math.max(engagement, 0) + 1) / Math.pow(ageHours + 2, 0.75);
  }

  private async trendingStats(postIds: string[], timezone?: string) {
    const ids = [...new Set(postIds)].filter(Boolean);
    if (!ids.length) return new Map<string, TrendingStats>();
    const { start, end } = this.localDayUtcRange(timezone);
    const [salutes, comments, reports] = await Promise.all([
      this.prisma.postLike.groupBy({ by: ['postId'], where: { postId: { in: ids }, createdAt: { gte: start, lt: end } }, _count: { postId: true } }),
      this.prisma.comment.groupBy({ by: ['postId'], where: { postId: { in: ids }, createdAt: { gte: start, lt: end } }, _count: { postId: true } }),
      this.prisma.postReport.groupBy({ by: ['postId'], where: { postId: { in: ids }, createdAt: { gte: start, lt: end } }, _count: { postId: true } }),
    ]);
    const map = new Map<string, TrendingStats>();
    const ensure = (postId: string) => {
      const existing = map.get(postId) ?? { salutes: 0, comments: 0, reports: 0 };
      map.set(postId, existing);
      return existing;
    };
    for (const row of salutes) ensure(row.postId).salutes = row._count.postId;
    for (const row of comments) ensure(row.postId).comments = row._count.postId;
    for (const row of reports) ensure(row.postId).reports = row._count.postId;
    return map;
  }

  private localDayUtcRange(timezone = 'UTC') {
    const safeTimezone = this.isValidTimezone(timezone) ? timezone : 'UTC';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: safeTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const year = get('year');
    const month = get('month');
    const day = get('day');
    return { start: this.zonedTimeToUtc(year, month, day, 0, 0, safeTimezone), end: this.zonedTimeToUtc(year, month, day + 1, 0, 0, safeTimezone) };
  }

  private zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
    let utc = new Date(Date.UTC(year, month - 1, day, hour, minute));
    for (let i = 0; i < 2; i += 1) utc = new Date(Date.UTC(year, month - 1, day, hour, minute) - this.timezoneOffsetMs(utc, timezone));
    return utc;
  }

  private timezoneOffsetMs(date: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(date);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(value('year'), value('month') - 1, value('day'), value('hour') % 24, value('minute'), value('second')) - date.getTime();
  }

  private isValidTimezone(timezone?: string) {
    if (!timezone) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); return true; } catch { return false; }
  }

  private postOrderBy(sort?: 'latest' | 'trending' | 'most-commented' | 'oldest') {
    if (sort === 'oldest') return { createdAt: 'asc' as const };
    if (sort === 'trending') return [{ likeCount: 'desc' as const }, { commentCount: 'desc' as const }, { createdAt: 'desc' as const }];
    if (sort === 'most-commented') return [{ commentCount: 'desc' as const }, { createdAt: 'desc' as const }];
    return { createdAt: 'desc' as const };
  }

  private postInclude() {
    return {
      author: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      profileOwner: { select: { id: true, displayName: true, username: true, profileImageUrl: true } },
      group: { select: { id: true, name: true, slug: true, visibility: true } },
      images: { orderBy: { sortOrder: 'asc' as const } },
      hashtags: { include: { hashtag: true } },
      buddySessionRecap: true,
      comments: { take: 2, where: { parentId: null }, orderBy: { createdAt: 'desc' as const }, include: { author: { select: { id: true, displayName: true, username: true } } } },
      _count: { select: { reposts: true } },
    } as const;
  }

  private include(withMembers = false) {
    return {
      _count: { select: { members: true, messages: true, posts: true, chatChannels: true } },
      messages: { take: 1, orderBy: { createdAt: 'desc' as const }, include: this.messageInclude() },
      chatChannels: { orderBy: { createdAt: 'asc' as const }, include: this.channelInclude() },
      posts: { take: 3, orderBy: { createdAt: 'desc' as const }, include: this.postInclude() },
      ...(withMembers ? { members: { include: { user: { select: { id: true, displayName: true, username: true, profileImageUrl: true } } } } } : {}),
    } as const;
  }

  private extractHashtags(text?: string) {
    return [...new Set((text?.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((tag) => tag.toLowerCase().replace(/^#/, '').trim()).filter(Boolean))];
  }

  private normalizeHashtags(value?: string) {
    return [...new Set((value ?? '')
      .split(',')
      .map((tag) => tag.toLowerCase().replace(/^#/, '').trim())
      .filter(Boolean))];
  }
}
