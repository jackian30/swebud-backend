import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { LocalStorageDriver } from '../src/uploads/media-library/local-storage.driver';

type TestUser = {
  id: string;
  accessToken: string;
  refreshToken: string;
};

describe('security boundaries (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const runId = randomUUID().slice(0, 8);
  const groupIds: string[] = [];
  const userIds: string[] = [];
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    assertDedicatedTestDatabase();
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET ??= 'e2e-access-secret-e2e-access-secret-e2e';
    process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret-e2e-refresh-secret-e2e';
    process.env.FRONTEND_ORIGIN ??= 'http://localhost:9000';
    process.env.NATIVE_AUTH_ENABLED = 'true';
    process.env.NATIVE_APP_ORIGIN = 'https://localhost';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ sendWelcomeEmail: jest.fn(), sendPasswordResetEmail: jest.fn() })
      .overrideProvider(LocalStorageDriver)
      .useValue({ put: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.badge.upsert({
      where: { id: 'badge_beta_user' },
      create: {
        id: 'badge_beta_user',
        code: 'beta_user',
        label: 'Beta user',
        iconUrl: '/badges/beta-user.svg',
      },
      update: {},
    });

    [owner, member, outsider] = await Promise.all([
      register('owner'),
      register('member'),
      register('outsider'),
    ]);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      if (groupIds.length) await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (app) await app.close();
  });

  it('issues email-free short-lived access tokens and rotating refresh sessions', () => {
    const payload = decodeJwtPayload(owner.accessToken);

    expect(payload).toEqual(expect.objectContaining({ sub: owner.id, onboarded: true }));
    expect(payload).not.toHaveProperty('email');
    expect(Number(payload.exp) - Number(payload.iat)).toBe(900);
  });

  it('keeps browser refresh tokens in a strict HttpOnly cookie and bootstraps without a body token', async () => {
    const label = `web-${runId}`;
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .set('Origin', 'http://localhost:9000')
      .send({
        email: `${label}@example.com`,
        password: 'Password123!',
        username: label,
        dateOfBirth: '1990-01-01T00:00:00.000Z',
        legalConsent: true,
        dataConsent: true,
      })
      .expect(201);
    userIds.push(registered.body.user.id);

    expect(registered.body).not.toHaveProperty('refreshToken');
    const cookie = registered.headers['set-cookie']?.[0];
    expect(cookie).toContain('swebud.refresh=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', 'http://localhost:9000')
      .set('Cookie', cookie.split(';')[0])
      .send({})
      .expect(200);

    expect(refreshed.body.accessToken).toBeTruthy();
    expect(refreshed.body).not.toHaveProperty('refreshToken');
    expect(refreshed.headers['set-cookie']?.[0]).toContain('swebud.refresh=');
    expect(refreshed.headers['cache-control']).toBe('no-store');
  });

  it('blocks direct private-group joins and filters private channels, previews, and counts per viewer', async () => {
    const created = await authed(owner, request(app.getHttpServer()).post('/groups'))
      .send({ name: `Private ${runId}`, slug: `private-${runId}`, visibility: 'private' })
      .expect(201);
    const group = created.body;
    groupIds.push(group.id);

    await authed(outsider, request(app.getHttpServer()).post(`/groups/${group.id}/join`))
      .expect(403);

    await authed(member, request(app.getHttpServer()).get(`/groups/invite/${group.inviteCode}`))
      .expect(404);
    await expect(prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId: member.id } },
    })).resolves.toBeNull();
    await authed(member, request(app.getHttpServer()).post('/groups/invite/accept'))
      .send({ code: group.inviteCode })
      .expect(201);

    await authed(owner, request(app.getHttpServer()).patch(`/groups/${group.id}/settings`))
      .send({ allowAnonymousPosts: true })
      .expect(200);

    const main = group.chatChannels.find((channel: { name: string }) => channel.name === 'main');
    expect(main?.id).toBeTruthy();

    const privateChannelResponse = await authed(owner, request(app.getHttpServer()).post(`/groups/${group.id}/channels`))
      .send({ name: 'owner room', visibility: 'private', memberIds: [owner.id] })
      .expect(201);
    const privateChannel = privateChannelResponse.body;

    const publicMessage = await authed(owner, request(app.getHttpServer()).post(`/groups/${group.id}/channels/${main.id}/messages`))
      .send({ body: 'visible preview' })
      .expect(201);
    expect(publicMessage.body.body).toBe('visible preview');

    const privateMessage = await authed(owner, request(app.getHttpServer()).post(`/groups/${group.id}/channels/${privateChannel.id}/messages`))
      .send({ body: 'private preview must stay hidden' })
      .expect(201);

    const mine = await authed(member, request(app.getHttpServer()).get('/groups/mine')).expect(200);
    const memberGroup = mine.body.find((candidate: { id: string }) => candidate.id === group.id);
    expect(memberGroup.lastMessage).toEqual(expect.objectContaining({ id: publicMessage.body.id, body: 'visible preview' }));
    expect(memberGroup.lastMessage.id).not.toBe(privateMessage.body.id);
    expect(memberGroup.chatChannels.map((channel: { id: string }) => channel.id)).toEqual([main.id]);
    expect(memberGroup._count).toEqual(expect.objectContaining({ messages: 1, chatChannels: 1 }));

    await authed(member, request(app.getHttpServer()).get(`/groups/${group.id}/channels/${privateChannel.id}/messages`))
      .expect(403);
    await authed(member, request(app.getHttpServer()).get(`/chat/messages/${privateMessage.body.id}/info`))
      .expect(403);
  });

  it('never discloses anonymous author IDs, even to other group members', async () => {
    const group = await prisma.group.findFirstOrThrow({ where: { id: { in: groupIds } }, select: { id: true } });
    const created = await authed(member, request(app.getHttpServer()).post(`/groups/${group.id}/posts`))
      .send({ text: 'anonymous security test', anonymous: true })
      .expect(201);

    expect(created.body).toEqual(expect.objectContaining({ anonymous: true, author: null, viewerCanManage: true }));
    expect(created.body).not.toHaveProperty('authorId');

    const listed = await authed(owner, request(app.getHttpServer()).get(`/groups/${group.id}/posts`)).expect(200);
    const post = listed.body.find((candidate: { id: string }) => candidate.id === created.body.id);
    expect(post).toEqual(expect.objectContaining({ anonymous: true, author: null, viewerCanManage: false }));
    expect(post).not.toHaveProperty('authorId');
  });

  it('redacts precise coordinates, provider raw activity data, and private recap fields from public post/profile views', async () => {
    const activity = await authed(member, request(app.getHttpServer()).post('/activities'))
      .send({
        type: 'run',
        title: 'Provider activity',
        startedAt: '2026-07-16T05:00:00.000Z',
        distanceMeters: 5000,
        raw: { accessToken: 'never-public', route: [{ latitude: 14.5995, longitude: 120.9842 }] },
      })
      .expect(201);

    const created = await authed(member, request(app.getHttpServer()).post('/posts'))
      .send({
        text: 'public activity security test',
        activityId: activity.body.id,
        latitude: 14.5995,
        longitude: 120.9842,
      })
      .expect(201);

    const profile = await authed(outsider, request(app.getHttpServer()).get(`/users/${member.id}`)).expect(200);
    const profilePost = profile.body.posts.find((candidate: { id: string }) => candidate.id === created.body.id);
    expect(profilePost).toBeTruthy();
    expect(profilePost).not.toHaveProperty('latitude');
    expect(profilePost).not.toHaveProperty('longitude');
    expect(profilePost.activity).toEqual(expect.objectContaining({ id: activity.body.id, distanceMeters: 5000 }));
    expect(profilePost.activity).not.toHaveProperty('raw');
    expect(profilePost.activity).not.toHaveProperty('userId');
    expect(profilePost.activity).not.toHaveProperty('integrationId');

    const recapPost = await prisma.post.create({
      data: { authorId: member.id, text: 'shared recap security test', visibility: 'public' },
      select: { id: true },
    });
    await prisma.buddySessionRecap.create({
      data: {
        ownerId: member.id,
        roomId: `room-${runId}`,
        roomName: 'Sensitive room',
        title: 'Safe recap title',
        participantCount: 2,
        participantPreview: [{ userId: owner.id, displayName: 'Hidden participant' }],
        areaLabel: 'Exact private area',
        startedAt: new Date('2026-07-16T05:00:00.000Z'),
        includeParticipants: false,
        includeBroadArea: false,
        visibility: 'public',
        sharedPostId: recapPost.id,
      },
    });

    const presented = await authed(outsider, request(app.getHttpServer()).get(`/posts/${recapPost.id}`)).expect(200);
    expect(presented.body.buddySessionRecap).toEqual(expect.objectContaining({
      title: 'Safe recap title',
      participantPreview: [],
      areaLabel: null,
    }));
    expect(presented.body.buddySessionRecap).not.toHaveProperty('ownerId');
    expect(presented.body.buddySessionRecap).not.toHaveProperty('roomId');
  });

  it('rejects server-stored private keys and insecure deterministic encrypted messages', async () => {
    await authed(owner, request(app.getHttpServer()).post('/chat/keys'))
      .send({ publicKey: 'owner-public-key', privateKey: 'must-never-reach-server' })
      .expect(400);

    const key = await authed(owner, request(app.getHttpServer()).post('/chat/keys'))
      .send({ publicKey: 'owner-public-key' })
      .expect(201);
    expect(key.body).toEqual({ id: owner.id, chatPublicKey: 'owner-public-key' });
    expect(key.body).not.toHaveProperty('privateKey');

    await authed(owner, request(app.getHttpServer()).post('/chat/requests'))
      .send({
        recipientId: outsider.id,
        body: 'ciphertext fallback',
        ciphertext: 'deterministic-public-id-ciphertext',
        nonce: 'public-id-derived-nonce',
        encrypted: true,
      })
      .expect(400);
  });

  it('invalidates an already-issued HTTP session as soon as an account is banned', async () => {
    await prisma.user.update({
      where: { id: outsider.id },
      data: { moderationStatus: 'banned', bannedAt: new Date(), banReason: 'e2e security test' },
    });

    await authed(outsider, request(app.getHttpServer()).get('/users/me')).expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', 'https://localhost')
      .set('X-SweBudd-Client', 'native')
      .send({ refreshToken: outsider.refreshToken })
      .expect(401);
  });

  async function register(label: string): Promise<TestUser> {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .set('Origin', 'https://localhost')
      .set('X-SweBudd-Client', 'native')
      .send({
        email: `${label}-${runId}@example.test`,
        password: 'correct-horse-battery-staple',
        username: `${label}_${runId}`,
        displayName: label,
        dateOfBirth: '1995-06-15T00:00:00.000Z',
        activityPersonas: ['runner'],
        legalConsent: true,
        dataConsent: true,
      })
      .expect(201);
    const testUser = {
      id: response.body.user.id,
      accessToken: response.body.accessToken,
      refreshToken: response.body.refreshToken,
    };
    userIds.push(testUser.id);
    return testUser;
  }
});

function authed(user: TestUser, pending: request.Test) {
  return pending.set('Authorization', `Bearer ${user.accessToken}`);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const encoded = token.split('.')[1];
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function assertDedicatedTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for security E2E tests.');
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!databaseName.toLowerCase().includes('test')) {
    throw new Error(`Refusing to run security E2E tests against non-test database "${databaseName}".`);
  }
}
