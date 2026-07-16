import { StoriesController } from './stories.controller';

describe('StoriesController', () => {
  const user = { id: 'viewer-1', email: 'viewer@swebud.loc' };
  const stories = {
    activeAuthors: jest.fn(),
  };
  const gateway = {
    emitMessage: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards validated active ActSnap author ids to the service', () => {
    stories.activeAuthors.mockResolvedValue([
      { authorId: 'author-1', storyId: 'actsnap-1' },
      { authorId: 'author-2', storyId: 'actsnap-2' },
    ]);

    const controller = new StoriesController(stories as any, gateway as any);

    void controller.activeAuthors(user, { userIds: ['author-1', 'author-2', 'author-3'] });

    expect(stories.activeAuthors).toHaveBeenCalledWith('viewer-1', [
      'author-1',
      'author-2',
      'author-3',
    ]);
  });
});
