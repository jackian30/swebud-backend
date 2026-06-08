import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateGroupDto, InviteGroupUsersDto } from './dto';

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
