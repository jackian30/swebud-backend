import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PostVisibility, ProfileVisibility, UserGender, UserReportReason } from '@prisma/client';
import { DeleteMeDto, ReportUserDto, UpdateMeDto } from './dto';

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
