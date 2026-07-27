import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import {
  GATEWAY_METADATA,
  MESSAGE_MAPPING_METADATA,
  MESSAGE_METADATA,
} from '@nestjs/websockets/constants';
import { readdirSync } from 'fs';
import { join, resolve } from 'path';
import { AdminJwtGuard } from '../admin-moderation/admin-jwt.guard';
import { UsersController } from '../users/users.controller';
import { ALLOW_PENDING_ONBOARDING } from './allow-pending-onboarding.decorator';
import { ALLOW_UNVERIFIED_MUTATION } from './allow-unverified-mutation.decorator';
import { VerifiedAccountGuard } from './verified-account.guard';

type ControllerType = new (...args: any[]) => unknown;

function sourceFiles(directory: string, suffix: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, suffix);
    return entry.name.endsWith(suffix) ? [path] : [];
  });
}

function appControllers() {
  const sourceRoot = resolve(__dirname, '..');
  const controllers = new Set<ControllerType>();
  for (const file of sourceFiles(sourceRoot, '.controller.ts')) {
    const exports = require(file) as Record<string, unknown>;
    for (const value of Object.values(exports)) {
      if (typeof value === 'function' && Reflect.hasMetadata(PATH_METADATA, value)) {
        controllers.add(value as ControllerType);
      }
    }
  }
  return [...controllers];
}

function appGateways() {
  const sourceRoot = resolve(__dirname, '..');
  const gateways = new Set<ControllerType>();
  for (const file of sourceFiles(sourceRoot, '.gateway.ts')) {
    const exports = require(file) as Record<string, unknown>;
    for (const value of Object.values(exports)) {
      if (typeof value === 'function' && Reflect.hasMetadata(GATEWAY_METADATA, value)) {
        gateways.add(value as ControllerType);
      }
    }
  }
  return [...gateways];
}

function guards(controller: ControllerType, handler: Function) {
  return [
    ...(Reflect.getMetadata(GUARDS_METADATA, controller) ?? []),
    ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
  ];
}

describe('verified-account mutation route matrix', () => {
  it('guards every HTTP mutation or gives it a route-specific documented exemption', () => {
    const missing: string[] = [];
    const exemptions: string[] = [];
    const controllers = appControllers();

    for (const controller of controllers) {
      for (const methodName of Object.getOwnPropertyNames(controller.prototype)) {
        if (methodName === 'constructor') continue;
        const handler = (controller.prototype as Record<string, Function>)[methodName];
        const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (
          requestMethod === undefined
          || requestMethod === RequestMethod.GET
          || requestMethod === RequestMethod.HEAD
          || requestMethod === RequestMethod.OPTIONS
        ) {
          continue;
        }

        const route = `${controller.name}.${methodName}`;
        const routeGuards = guards(controller, handler);
        const rationale = Reflect.getMetadata(ALLOW_UNVERIFIED_MUTATION, handler) as string | undefined;
        if (rationale?.trim().length) {
          exemptions.push(`${route}: ${rationale}`);
          continue;
        }
        if (routeGuards.includes(VerifiedAccountGuard) || routeGuards.includes(AdminJwtGuard)) continue;
        missing.push(route);
      }
    }

    expect(controllers.length).toBeGreaterThanOrEqual(15);
    expect(exemptions).toEqual(expect.arrayContaining([
      expect.stringContaining('AuthController.register:'),
      expect.stringContaining('UsersController.deleteMe:'),
      expect.stringContaining('PostsController.report:'),
      expect.stringContaining('UsersController.block:'),
    ]));
    expect(missing).toEqual([]);
  });

  it.each(['completeOnboarding', 'updateAccount', 'updatePassword', 'deleteMe', 'sessions', 'revokeSession'])(
    'keeps UsersController.%s available during pending onboarding for recovery or account security',
    (methodName) => {
      expect(Reflect.getMetadata(
        ALLOW_PENDING_ONBOARDING,
        (UsersController.prototype as unknown as Record<string, Function>)[methodName],
      )).toBe(true);
    },
  );

  it('revalidates every client-originated websocket event through the verified account policy', () => {
    const events: string[] = [];
    const missing: string[] = [];
    for (const gateway of appGateways()) {
      for (const methodName of Object.getOwnPropertyNames(gateway.prototype)) {
        const handler = (gateway.prototype as Record<string, Function>)[methodName];
        if (!handler || !Reflect.getMetadata(MESSAGE_MAPPING_METADATA, handler)) continue;
        const event = String(Reflect.getMetadata(MESSAGE_METADATA, handler));
        events.push(event);
        if (!handler.toString().includes('this.activeVerifiedUserId(client)')) {
          missing.push(`${gateway.name}.${methodName} (${event})`);
        }
      }
    }

    expect(new Set(events)).toEqual(new Set(['chat:send', 'chat:typing', 'buddy:room-typing']));
    expect(missing).toEqual([]);
  });
});
