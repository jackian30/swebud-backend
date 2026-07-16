import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { ActivityListQueryDto, ActivityStatsQueryDto, ActivityStatsWindow } from './dto';

describe('Activities request validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

  it('accepts only supported statistics windows', async () => {
    const metadata = { type: 'query' as const, metatype: ActivityStatsQueryDto, data: '' };
    await expect(pipe.transform({ window: 'week' }, metadata)).resolves.toEqual({ window: ActivityStatsWindow.week });
    await expect(pipe.transform({ window: 'garbage' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires an integer list size between 1 and 100', async () => {
    const metadata = { type: 'query' as const, metatype: ActivityListQueryDto, data: '' };
    await expect(pipe.transform({ take: '25' }, metadata)).resolves.toEqual({ take: 25 });
    await expect(pipe.transform({ take: '0' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ take: '101' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails closed inside the service if validation is bypassed', async () => {
    const prisma = { activity: { aggregate: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() } };
    const service = new ActivitiesService(prisma as any);

    await expect(service.stats('user-1', 'garbage' as ActivityStatsWindow)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.activity.aggregate).not.toHaveBeenCalled();
  });
});
