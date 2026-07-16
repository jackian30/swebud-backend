import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PostVisibility, ProfileVisibility, UserGender, UserReportReason } from '@prisma/client';
import { DeleteMeDto, ReportUserDto, SaveSearchHistoryDto, UpdateMeDto, UserFollowingQueryDto, UserSearchHistoryQueryDto, UserSearchQueryDto } from './dto';

describe('user query DTOs', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const transform = (metatype: new () => unknown, value: unknown) => pipe.transform(value, { type: 'query', metatype, data: '' });

  it('coerces strict following and bounded search queries', async () => {
    await expect(transform(UserFollowingQueryDto, { nonFollowback: 'false' })).resolves.toEqual({ nonFollowback: false });
    await expect(transform(UserSearchQueryDto, { q: '  Alice  ', take: '25', cursor: '0' })).resolves.toEqual({
      q: 'Alice',
      take: 25,
      cursor: 0,
    });
    await expect(transform(UserSearchHistoryQueryDto, { take: '1000', cursor: '1000' })).resolves.toEqual({ take: 1000, cursor: 1000 });
  });

  it.each([
    [{ nonFollowback: 'yes' }, UserFollowingQueryDto],
    [{ q: 'x'.repeat(121) }, UserSearchQueryDto],
    [{ take: '51' }, UserSearchQueryDto],
    [{ cursor: '-1' }, UserSearchQueryDto],
    [{ take: '1001' }, UserSearchHistoryQueryDto],
    [{ cursor: '1001' }, UserSearchHistoryQueryDto],
  ] as const)('rejects malformed user query %#', async (value, metatype) => {
    await expect(transform(metatype, value)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UpdateMeDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body' as const, metatype: UpdateMeDto, data: '' };

  it('accepts the current profile update API contract', async () => {
    const value = await pipe.transform({
      displayName: 'Alice SweBudd',
      username: '@Alice.Fit',
      bio: 'Training daily',
      profileImageUrl: '/api/uploads/profile-photos/profile.webp',
      coverImageUrl: '/api/uploads/cover-photos/cover.webp',
      gender: UserGender.female,
      dateOfBirth: '1998-02-14',
      activityPersonas: ['runner'],
      profileVisibility: ProfileVisibility.private,
      defaultPostVisibility: PostVisibility.only_me,
    }, metadata);

    expect(value).toEqual(expect.objectContaining({
      displayName: 'Alice SweBudd',
      username: '@Alice.Fit',
      profileVisibility: ProfileVisibility.private,
      defaultPostVisibility: PostVisibility.only_me,
    }));
    expect(value.dateOfBirth).toBeInstanceOf(Date);
  });

  it('rejects removed profile settings instead of silently persisting them', async () => {
    await expect(pipe.transform({
      displayName: 'Alice SweBudd',
      allowMessagesFrom: 'followers',
      showAge: true,
    }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['displayName', 'username', 'activityPersonas', 'profileVisibility', 'defaultPostVisibility', 'hideProfileBadges', 'hiddenProfileBadgeCodes'])(
    'rejects null for the non-null profile setting %s',
    async (field) => {
      await expect(pipe.transform({ [field]: null }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('accepts null only for intentionally clearable profile fields', async () => {
    await expect(pipe.transform({
      bio: null,
      profileImageUrl: null,
      coverImageUrl: null,
      gender: null,
      dateOfBirth: null,
      latitude: null,
      longitude: null,
      activityPersona: null,
    }, metadata)).resolves.toEqual({
      bio: null,
      profileImageUrl: null,
      coverImageUrl: null,
      gender: null,
      dateOfBirth: null,
      latitude: null,
      longitude: null,
      activityPersona: null,
    });
  });
});

describe('ReportUserDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body' as const, metatype: ReportUserDto, data: '' };

  it('accepts a profile report reason and note', async () => {
    await expect(pipe.transform({
      reason: UserReportReason.harassment,
      note: 'Sending abusive messages',
    }, metadata)).resolves.toEqual({
      reason: UserReportReason.harassment,
      note: 'Sending abusive messages',
    });
  });

  it('rejects invalid profile report reasons', async () => {
    await expect(pipe.transform({
      reason: 'not_a_reason',
    }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SaveSearchHistoryDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body' as const, metatype: SaveSearchHistoryDto, data: '' };

  it('accepts a user entry with a UUID target', async () => {
    await expect(pipe.transform({
      type: 'user',
      targetUserId: '8b22395d-7ef9-45cb-ad49-e4afee2f9f63',
    }, metadata)).resolves.toEqual({
      type: 'user',
      targetUserId: '8b22395d-7ef9-45cb-ad49-e4afee2f9f63',
    });
  });

  it('rejects unsupported entry types and malformed target ids', async () => {
    await expect(pipe.transform({ type: 'recent' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ type: 'user', targetUserId: 'not-a-uuid' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DeleteMeDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body' as const, metatype: DeleteMeDto, data: '' };

  it('requires a delete confirmation phrase', async () => {
    await expect(pipe.transform({ confirmation: 'delete @alice' }, metadata)).resolves.toEqual({
      confirmation: 'delete @alice',
    });
    await expect(pipe.transform({}, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});
