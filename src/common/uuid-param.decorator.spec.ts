import 'reflect-metadata';
import { BadRequestException, ParseEnumPipe, ParseUUIDPipe } from '@nestjs/common';
import { PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ActivitiesController } from '../activities/activities.controller';
import { BuddyController } from '../buddy/buddy.controller';
import { ChatController } from '../chat/chat.controller';
import { GroupsController } from '../groups/groups.controller';
import { IntegrationsController } from '../integrations/integrations.controller';
import { NotificationsController } from '../notifications/notifications.controller';
import { PostsController } from '../posts/posts.controller';
import { StoriesController } from '../stories/stories.controller';
import { UsersController } from '../users/users.controller';

type ControllerType = { name: string; prototype: object };
type RouteParameterMetadata = { data?: string; pipes?: unknown[] };

const controllers: ControllerType[] = [
  ActivitiesController,
  BuddyController,
  ChatController,
  GroupsController,
  IntegrationsController,
  NotificationsController,
  PostsController,
  StoriesController,
  UsersController,
];

const nonUuidParameters = new Set([
  'GroupsController.get.slug',
  'IntegrationsController.oauthStart.provider',
  'IntegrationsController.update.provider',
  'IntegrationsController.disconnect.provider',
  'UsersController.addCloseBuddy.id',
  'UsersController.removeCloseBuddy.id',
  'UsersController.profileFollowers.id',
  'UsersController.profileFollowing.id',
  'UsersController.follow.id',
  'UsersController.unfollow.id',
  'UsersController.block.id',
  'UsersController.unblock.id',
  'UsersController.report.id',
  'UsersController.profile.id',
]);

function pipeIs(pipe: unknown, type: new (...args: any[]) => unknown) {
  return pipe === type || pipe instanceof type;
}

describe('UUID route parameter boundary', () => {
  it('applies UUID parsing to every UUID-backed controller parameter', () => {
    const seenNonUuidParameters = new Set<string>();

    for (const controller of controllers) {
      for (const methodName of Object.getOwnPropertyNames(controller.prototype).filter((name) => name !== 'constructor')) {
        const method = (controller.prototype as Record<string, unknown>)[methodName];
        if (typeof method !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, method) as string | string[] | undefined;
        if (path === undefined) continue;
        const paths = Array.isArray(path) ? path : [path];
        const placeholders = [...new Set(paths.flatMap((value) => [...value.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1])))]
          .sort();
        const routeMetadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, methodName) as Record<string, RouteParameterMetadata> | undefined;
        const parameters = Object.entries(routeMetadata ?? {})
          .filter(([key]) => key.startsWith(`${RouteParamtypes.PARAM}:`))
          .map(([, value]) => value);

        expect(parameters.map((parameter) => parameter.data).sort()).toEqual(placeholders);
        for (const parameter of parameters) {
          const key = `${controller.name}.${methodName}.${parameter.data}`;
          const hasUuidPipe = (parameter.pipes ?? []).some((pipe) => pipeIs(pipe, ParseUUIDPipe));
          if (nonUuidParameters.has(key)) {
            seenNonUuidParameters.add(key);
            expect(hasUuidPipe).toBe(false);
            if (parameter.data === 'provider') {
              expect((parameter.pipes ?? []).some((pipe) => pipeIs(pipe, ParseEnumPipe))).toBe(true);
            }
          } else {
            expect(hasUuidPipe).toBe(true);
          }
        }
      }
    }

    expect([...seenNonUuidParameters].sort()).toEqual([...nonUuidParameters].sort());
  });

  it('rejects malformed UUIDs before a controller can call its service', async () => {
    const pipe = new ParseUUIDPipe();
    const metadata = { type: 'param' as const, metatype: String, data: 'id' };
    const id = '8b22395d-7ef9-45cb-ad49-e4afee2f9f63';

    await expect(pipe.transform(id, metadata)).resolves.toBe(id);
    await expect(pipe.transform('not-a-uuid', metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});
