import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';

describe('AdminService database browser', () => {
  it('redacts sensitive fields before database rows leave the API', () => {
    const service = new AdminService({} as any);

    const row = (service as any).presentDatabaseRow('refreshToken', {
      id: 'session-1',
      userId: 'user-1',
      tokenHash: 'secret-hash',
      createdAt: new Date('2026-05-11T00:00:00.000Z'),
    });

    expect(row).toEqual(expect.objectContaining({ id: 'session-1', userId: 'user-1', $recordKey: expect.any(String) }));
    expect(row).not.toHaveProperty('tokenHash');
  });

  it('blocks generic database edits to sensitive fields', () => {
    const service = new AdminService({} as any);

    expect(() => service.updateDatabaseRecord('user', encodeURIComponent(JSON.stringify({ id: 'user-1' })), {
      data: { passwordHash: 'replacement' },
    })).toThrow(BadRequestException);
  });
});
