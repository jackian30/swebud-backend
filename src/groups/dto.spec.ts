import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateGroupChannelDto, CreateGroupDto, GroupChatMuteDto, GroupInviteCandidatesQueryDto, GroupListQueryDto, GroupMineQueryDto, GroupPostDto, GroupPostsQueryDto, GroupSummaryQueryDto, InviteGroupUsersDto } from './dto';

describe('group query DTOs', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const transform = (metatype: new () => unknown, value: unknown) => pipe.transform(value, { type: 'query', metatype, data: '' });

  it('coerces valid list pagination and strict booleans', async () => {
    await expect(transform(GroupListQueryDto, { take: '25', cursor: '0', discover: 'false' })).resolves.toEqual({
      take: 25,
      cursor: 0,
      discover: false,
    });
    await expect(transform(GroupMineQueryDto, { take: '50', cursor: '100000' })).resolves.toEqual({ take: 50, cursor: 100_000 });
    await expect(transform(GroupSummaryQueryDto, { summary: 'true' })).resolves.toEqual({ summary: true });
  });

  it.each([
    [{ take: '51' }, GroupListQueryDto],
    [{ cursor: '-1' }, GroupMineQueryDto],
    [{ discover: 'yes' }, GroupListQueryDto],
    [{ summary: '1' }, GroupSummaryQueryDto],
  ] as const)('rejects malformed or out-of-range list query %#', async (value, metatype) => {
    await expect(transform(metatype, value)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalizes bounded invite and post search queries', async () => {
    await expect(transform(GroupInviteCandidatesQueryDto, { q: '  Alice  ' })).resolves.toEqual({ q: 'Alice' });
    await expect(transform(GroupPostsQueryDto, {
      sort: 'trending',
      hashtag: ' strength,fitness ',
      q: '  morning workout  ',
      mine: 'true',
      take: '20',
      cursor: '0',
      timezone: 'Asia/Manila',
    })).resolves.toEqual({
      sort: 'trending',
      hashtag: 'strength,fitness',
      q: 'morning workout',
      mine: true,
      take: 20,
      cursor: 0,
      timezone: 'Asia/Manila',
    });
  });

  it.each([
    { sort: 'newest' },
    { mine: '1' },
    { take: '0' },
    { cursor: '100001' },
    { timezone: 'not/a-timezone' },
    { q: 'x'.repeat(121) },
  ])('rejects invalid group post query %#', async (value) => {
    await expect(transform(GroupPostsQueryDto, value)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CreateGroupDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body', metatype: CreateGroupDto, data: '' } as const;

  it('normalizes mobile-entered group slugs before validation', async () => {
    const dto = await pipe.transform({
      name: 'Mobile Group',
      slug: 'Mobile Group_One',
      description: 'Created from Android keyboard input.',
      visibility: 'public',
    }, metadata);

    expect(dto).toMatchObject({ slug: 'mobile-group-one' });
  });

  it('rejects group slugs that are too short after normalization', async () => {
    await expect(pipe.transform({
      name: 'Nope',
      slug: 'A!',
      visibility: 'public',
    }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts invite user ids during group creation', async () => {
    const dto = await pipe.transform({
      name: 'Invite Group',
      slug: 'invite-group',
      inviteUserIds: ['8b22395d-7ef9-45cb-ad49-e4afee2f9f63'],
    }, metadata);

    expect(dto).toMatchObject({ inviteUserIds: ['8b22395d-7ef9-45cb-ad49-e4afee2f9f63'] });
  });
});

describe('InviteGroupUsersDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body', metatype: InviteGroupUsersDto, data: '' } as const;

  it('rejects malformed invite ids', async () => {
    await expect(pipe.transform({ userIds: ['not-a-user-id'] }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CreateGroupChannelDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body', metatype: CreateGroupChannelDto, data: '' } as const;
  const memberId = '8b22395d-7ef9-45cb-ad49-e4afee2f9f63';

  it('accepts at most 50 UUID member ids', async () => {
    const memberIds = Array.from({ length: 50 }, () => memberId);
    await expect(pipe.transform({ name: 'Private channel', memberIds }, metadata)).resolves.toEqual({ name: 'Private channel', memberIds });
  });

  it('rejects malformed and oversized member id lists', async () => {
    await expect(pipe.transform({ name: 'Private channel', memberIds: ['not-a-uuid'] }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ name: 'Private channel', memberIds: Array.from({ length: 51 }, () => memberId) }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GroupPostDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body', metatype: GroupPostDto, data: '' } as const;

  it.each(['type', 'mediaType'] as const)('rejects unsupported image %s values', async (field) => {
    await expect(pipe.transform({
      images: [{ url: '/uploads/posts/file.bin', [field]: 'binary' }],
    }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GroupChatMuteDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body' as const, metatype: GroupChatMuteDto, data: '' };

  it('accepts the explicit null sent by clients when unmuting', async () => {
    await expect(pipe.transform({ muted: false, mutedUntil: null }, metadata)).resolves.toEqual({ muted: false, mutedUntil: null });
  });
});
