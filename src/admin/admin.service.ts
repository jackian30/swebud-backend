import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminDatabaseQueryDto, AdminListQueryDto, AdminUpdateGroupDto, AdminUpdatePostDto, AdminUpdateRecordDto, AdminUpdateUserDto } from './dto';

const DEFAULT_ROLE_KEYS = ['user'];
const ADMIN_ROLE_KEY = 'admin';

const DATABASE_TABLES = [
  'user',
  'role',
  'userRole',
  'userActivityPersona',
  'post',
  'postImage',
  'comment',
  'group',
  'groupMember',
  'groupPost',
  'follow',
  'followRequest',
  'message',
  'messageRequest',
  'notification',
  'story',
  'storyView',
  'storyReaction',
  'postLike',
  'postSave',
  'repost',
  'postReport',
  'userReport',
  'refreshToken',
  'passwordResetToken',
] as const;

type DatabaseTable = typeof DATABASE_TABLES[number];

const RECORD_KEYS: Record<DatabaseTable, { fields: string[]; compound?: string }> = {
  user: { fields: ['id'] },
  role: { fields: ['id'] },
  userRole: { fields: ['userId', 'roleId'], compound: 'userId_roleId' },
  userActivityPersona: { fields: ['userId', 'persona'], compound: 'userId_persona' },
  post: { fields: ['id'] },
  postImage: { fields: ['id'] },
  comment: { fields: ['id'] },
  group: { fields: ['id'] },
  groupMember: { fields: ['groupId', 'userId'], compound: 'groupId_userId' },
  groupPost: { fields: ['id'] },
  follow: { fields: ['followerId', 'followingId'], compound: 'followerId_followingId' },
  followRequest: { fields: ['id'] },
  message: { fields: ['id'] },
  messageRequest: { fields: ['id'] },
  notification: { fields: ['id'] },
  story: { fields: ['id'] },
  storyView: { fields: ['storyId', 'userId'], compound: 'storyId_userId' },
  storyReaction: { fields: ['storyId', 'userId'], compound: 'storyId_userId' },
  postLike: { fields: ['postId', 'userId'], compound: 'postId_userId' },
  postSave: { fields: ['postId', 'userId'], compound: 'postId_userId' },
  repost: { fields: ['id'] },
  postReport: { fields: ['id'] },
  userReport: { fields: ['id'] },
  refreshToken: { fields: ['id'] },
  passwordResetToken: { fields: ['id'] },
};

const SENSITIVE_DATABASE_FIELDS = new Set(['passwordHash', 'tokenHash', 'chatPublicKey', 'nonce', 'ciphertext']);

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async me(userId: string) {
    return this.presentUser(await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: this.userSelect() }));
  }

  roles() {
    return this.prisma.role.findMany({ orderBy: { name: 'asc' } });
  }

  async stats() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [users, posts, groups, comments, reports, activeSessions, newUsers24h, posts24h] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.post.count(),
      this.prisma.group.count(),
      this.prisma.comment.count(),
      Promise.all([this.prisma.postReport.count(), this.prisma.userReport.count()]).then(([postReports, userReports]) => postReports + userReports),
      this.prisma.refreshToken.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
      this.prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.post.count({ where: { createdAt: { gte: dayAgo } } }),
    ]);
    return { users, posts, groups, comments, reports, activeSessions, newUsers24h, posts24h };
  }

  async analytics() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const days = Array.from({ length: 7 }, (_, index) => {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - (6 - index));
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { label: start.toLocaleDateString('en', { month: 'short', day: 'numeric' }), start, end };
    });

    const [
      totals,
      last24h,
      activitySeries,
      moderation,
      topPosts,
      topUsers,
    ] = await Promise.all([
      Promise.all([
        this.prisma.user.count(),
        this.prisma.post.count(),
        this.prisma.comment.count(),
        this.prisma.postLike.count(),
        this.prisma.repost.count(),
        this.prisma.story.count({ where: { expiresAt: { gt: now } } }),
        this.prisma.refreshToken.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
      ]),
      Promise.all([
        this.prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
        this.prisma.post.count({ where: { createdAt: { gte: dayAgo } } }),
        this.prisma.comment.count({ where: { createdAt: { gte: dayAgo } } }),
        this.prisma.postLike.count({ where: { createdAt: { gte: dayAgo } } }),
        this.prisma.repost.count({ where: { createdAt: { gte: dayAgo } } }),
      ]),
      Promise.all(days.map(async (day) => {
        const [users, posts, comments, likes, reposts] = await Promise.all([
          this.prisma.user.count({ where: { createdAt: { gte: day.start, lt: day.end } } }),
          this.prisma.post.count({ where: { createdAt: { gte: day.start, lt: day.end } } }),
          this.prisma.comment.count({ where: { createdAt: { gte: day.start, lt: day.end } } }),
          this.prisma.postLike.count({ where: { createdAt: { gte: day.start, lt: day.end } } }),
          this.prisma.repost.count({ where: { createdAt: { gte: day.start, lt: day.end } } }),
        ]);
        return { label: day.label, users, posts, comments, likes, reposts };
      })),
      Promise.all([
        this.prisma.postReport.count(),
        this.prisma.userReport.count(),
        this.prisma.postReport.count({ where: { createdAt: { gte: weekAgo } } }),
        this.prisma.userReport.count({ where: { createdAt: { gte: weekAgo } } }),
      ]),
      this.prisma.post.findMany({
        orderBy: [{ likeCount: 'desc' }, { commentCount: 'desc' }, { createdAt: 'desc' }],
        take: 5,
        include: { author: { select: this.userMiniSelect() }, _count: { select: { reports: true, reposts: true } } },
      }),
      this.prisma.user.findMany({
        orderBy: [{ posts: { _count: 'desc' } }, { createdAt: 'desc' }],
        take: 5,
        select: this.userSelect(),
      }),
    ]);

    const [users, posts, comments, likes, reposts, activeStories, activeSessions] = totals;
    const [newUsers24h, posts24h, comments24h, likes24h, reposts24h] = last24h;
    const [postReports, userReports, postReports7d, userReports7d] = moderation;
    return {
      generatedAt: now.toISOString(),
      totals: { users, posts, comments, likes, reposts, activeStories, activeSessions },
      last24h: { newUsers: newUsers24h, posts: posts24h, comments: comments24h, likes: likes24h, reposts: reposts24h },
      activitySeries,
      moderation: { openReports: postReports + userReports, postReports, userReports, reports7d: postReports7d + userReports7d },
      topPosts,
      topUsers: topUsers.map((user) => this.presentUser(user)),
    };
  }

  listUsers(query: AdminListQueryDto) {
    const { take, skip } = this.page(query);
    const q = query.q?.trim();
    return this.prisma.user.findMany({
      where: q ? {
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { username: { contains: q.replace(/^@/, ''), mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      select: this.userSelect(),
    }).then((users) => users.map((user) => this.presentUser(user)));
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: this.userSelect() });
    if (!user) throw new NotFoundException('User not found');
    return this.presentUser(user);
  }

  async updateUser(actorId: string, id: string, dto: AdminUpdateUserDto) {
    const roleKeys = dto.roleKeys ? this.normalizeRoleKeys(dto.roleKeys) : undefined;
    if (roleKeys && actorId === id && !roleKeys.includes(ADMIN_ROLE_KEY)) throw new ForbiddenException('You cannot remove your own admin access');
    const username = dto.username?.toLowerCase().replace(/^@/, '').trim().replace(/[^a-z0-9._-]/g, '');
    if (dto.username !== undefined && !username) throw new BadRequestException('Username is required');
    if (username) {
      const existing = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
      if (existing && existing.id !== id) throw new ConflictException('Username already taken');
    }
    if (dto.email) {
      const email = dto.email.toLowerCase().trim();
      const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing && existing.id !== id) throw new ConflictException('Email already registered');
    }
    if (roleKeys) await this.ensureRoles(roleKeys);
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.email !== undefined ? { email: dto.email.toLowerCase().trim() } : {}),
        ...(username ? { username, usernameFinalized: true } : {}),
        ...(dto.displayName !== undefined ? { displayName: dto.displayName.trim() || null } : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio.trim() || null } : {}),
        ...(dto.verified !== undefined ? { verified: dto.verified } : {}),
        ...(roleKeys ? { roles: { deleteMany: {}, create: roleKeys.map((key) => ({ role: { connect: { key } } })) } } : {}),
      },
      select: this.userSelect(),
    });
    return this.presentUser(user);
  }

  async deleteUser(actorId: string, id: string) {
    if (actorId === id) throw new ForbiddenException('You cannot delete your own account');
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }

  revokeUserSessions(id: string) {
    return this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } })
      .then((result) => ({ ok: true, revoked: result.count }));
  }

  listPosts(query: AdminListQueryDto) {
    const { take, skip } = this.page(query);
    const q = query.q?.trim();
    return this.prisma.post.findMany({
      where: q ? {
        OR: [
          { text: { contains: q, mode: 'insensitive' } },
          { author: { username: { contains: q.replace(/^@/, ''), mode: 'insensitive' } } },
          { author: { email: { contains: q, mode: 'insensitive' } } },
        ],
      } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: {
        author: { select: this.userMiniSelect() },
        group: { select: { id: true, name: true, slug: true, visibility: true } },
        images: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { comments: true, likes: true, reports: true, reposts: true } },
      },
    });
  }

  async updatePost(id: string, dto: AdminUpdatePostDto) {
    return this.prisma.post.update({
      where: { id },
      data: {
        ...(dto.text !== undefined ? { text: dto.text.trim() || null, editedAt: new Date() } : {}),
        ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
        ...(dto.pinned !== undefined ? { pinnedAt: dto.pinned ? new Date() : null } : {}),
      },
      include: { author: { select: this.userMiniSelect() }, group: true, _count: { select: { comments: true, likes: true, reports: true } } },
    });
  }

  async deletePost(id: string) {
    await this.prisma.post.delete({ where: { id } });
    return { ok: true };
  }

  listGroups(query: AdminListQueryDto) {
    const { take, skip } = this.page(query);
    const q = query.q?.trim();
    return this.prisma.group.findMany({
      where: q ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
        ],
      } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: { _count: { select: { members: true, posts: true, messages: true } } },
    });
  }

  async updateGroup(id: string, dto: AdminUpdateGroupDto) {
    return this.prisma.group.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        ...(dto.profileImageUrl !== undefined ? { profileImageUrl: dto.profileImageUrl.trim() || null } : {}),
        ...(dto.coverImageUrl !== undefined ? { coverImageUrl: dto.coverImageUrl.trim() || null } : {}),
        ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
        ...(dto.allowAnonymousPosts !== undefined ? { allowAnonymousPosts: dto.allowAnonymousPosts } : {}),
      },
      include: { _count: { select: { members: true, posts: true, messages: true } } },
    });
  }

  async deleteGroup(id: string) {
    await this.prisma.group.delete({ where: { id } });
    return { ok: true };
  }

  async reports() {
    const [postReports, userReports] = await Promise.all([
      this.prisma.postReport.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { user: { select: this.userMiniSelect() }, post: { include: { author: { select: this.userMiniSelect() } } } },
      }),
      this.prisma.userReport.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { reporter: { select: this.userMiniSelect() }, reported: { select: this.userMiniSelect() } },
      }),
    ]);
    return { postReports, userReports };
  }

  async resolvePostReport(id: string) {
    await this.prisma.postReport.delete({ where: { id } });
    return { ok: true };
  }

  async resolveUserReport(id: string) {
    await this.prisma.userReport.delete({ where: { id } });
    return { ok: true };
  }

  databaseTables() {
    return DATABASE_TABLES.map((name) => ({ name }));
  }

  async databaseRows(table: string, query: AdminDatabaseQueryDto) {
    const delegate = this.databaseDelegate(table);
    const { take, skip } = this.page(query);
    const orderByField = query.orderBy?.trim() || this.defaultOrderField(table);
    const order = query.order === 'asc' ? 'asc' : 'desc';
    const [rows, count] = await Promise.all([
      delegate.findMany({ take, skip, orderBy: orderByField ? { [orderByField]: order } : undefined }),
      delegate.count(),
    ]);
    return { table, count, rows: rows.map((row: Record<string, unknown>) => this.presentDatabaseRow(table as DatabaseTable, row)) };
  }

  updateDatabaseRecord(table: string, recordKey: string, dto: AdminUpdateRecordDto) {
    if (!dto.data || typeof dto.data !== 'object' || Array.isArray(dto.data)) throw new BadRequestException('data object is required');
    const sensitiveKeys = Object.keys(dto.data).filter((key) => SENSITIVE_DATABASE_FIELDS.has(key));
    if (sensitiveKeys.length) throw new BadRequestException(`Cannot update sensitive field: ${sensitiveKeys.join(', ')}`);
    return this.databaseDelegate(table).update({ where: this.decodeRecordKey(table as DatabaseTable, recordKey), data: dto.data });
  }

  async deleteDatabaseRecord(table: string, recordKey: string) {
    await this.databaseDelegate(table).delete({ where: this.decodeRecordKey(table as DatabaseTable, recordKey) });
    return { ok: true };
  }

  private page(query: AdminListQueryDto) {
    const parsedTake = Number.parseInt(query.take ?? '25', 10);
    const parsedSkip = Number.parseInt(query.skip ?? '0', 10);
    return {
      take: Number.isFinite(parsedTake) ? Math.min(Math.max(parsedTake, 1), 100) : 25,
      skip: Number.isFinite(parsedSkip) ? Math.max(parsedSkip, 0) : 0,
    };
  }

  private userSelect() {
    return { id: true, email: true, username: true, displayName: true, bio: true, profileImageUrl: true, verified: true, usernameFinalized: true, createdAt: true, updatedAt: true, roles: { include: { role: true } }, _count: { select: { posts: true, comments: true, followers: true, following: true, groupMembers: true, userReportsReceived: true } } } as const;
  }

  private userMiniSelect() {
    return { id: true, email: true, username: true, displayName: true, profileImageUrl: true, verified: true, roles: { include: { role: true } } } as const;
  }

  private presentUser<T extends { roles?: Array<{ role: { key: string; name: string } }> }>(user: T) {
    const roleKeys = user.roles?.map((item) => item.role.key) ?? [];
    return {
      ...user,
      roleKeys,
      isAdmin: roleKeys.includes(ADMIN_ROLE_KEY),
    };
  }

  private normalizeRoleKeys(roleKeys: string[]) {
    const normalized = [...new Set([...roleKeys, ...DEFAULT_ROLE_KEYS].map((key) => key.trim().toLowerCase()).filter(Boolean))];
    return normalized;
  }

  private async ensureRoles(roleKeys: string[]) {
    const existing = await this.prisma.role.findMany({ where: { key: { in: roleKeys } }, select: { key: true } });
    const existingKeys = new Set(existing.map((role) => role.key));
    const missing = roleKeys.filter((key) => !existingKeys.has(key));
    if (missing.length) throw new BadRequestException(`Unknown role: ${missing.join(', ')}`);
  }

  private databaseDelegate(table: string) {
    if (!DATABASE_TABLES.includes(table as DatabaseTable)) throw new NotFoundException('Database table not found');
    return (this.prisma as any)[table];
  }

  private encodeRecordKey(table: DatabaseTable, row: Record<string, unknown>) {
    const key = RECORD_KEYS[table];
    return encodeURIComponent(JSON.stringify(Object.fromEntries(key.fields.map((field) => [field, row[field]]))));
  }

  private presentDatabaseRow(table: DatabaseTable, row: Record<string, unknown>) {
    return {
      ...Object.fromEntries(Object.entries(row).filter(([key]) => !SENSITIVE_DATABASE_FIELDS.has(key))),
      $recordKey: this.encodeRecordKey(table, row),
    };
  }

  private decodeRecordKey(table: DatabaseTable, recordKey: string) {
    if (!DATABASE_TABLES.includes(table)) throw new NotFoundException('Database table not found');
    const key = RECORD_KEYS[table];
    let values: Record<string, unknown>;
    try {
      values = JSON.parse(decodeURIComponent(recordKey)) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Invalid record key');
    }
    if (key.fields.some((field) => values[field] == null)) throw new BadRequestException('Invalid record key');
    if (!key.compound) return { [key.fields[0]]: values[key.fields[0]] };
    return { [key.compound]: Object.fromEntries(key.fields.map((field) => [field, values[field]])) };
  }

  private defaultOrderField(table: string) {
    const fields: Record<string, string | null> = {
      userRole: 'assignedAt',
      userActivityPersona: 'sortOrder',
      postImage: null,
      groupMember: 'joinedAt',
      storyView: 'viewedAt',
      postLike: 'createdAt',
      postSave: 'createdAt',
    };
    return Object.prototype.hasOwnProperty.call(fields, table) ? fields[table] : 'createdAt';
  }
}
