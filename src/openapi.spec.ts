import type { OpenAPIObject } from '@nestjs/swagger';
import { readFileSync } from 'fs';
import { join } from 'path';
import { assertValidOpenApiDocument, openApiSetupOptions } from './openapi';
import { assertNoDuplicateContractSchemas, CLIENT_RESPONSE_SCHEMAS } from './openapi.contract';
import { FRONTEND_OPERATION_CONTRACTS } from './openapi.operations';

function artifact(): OpenAPIObject {
  return JSON.parse(readFileSync(join(process.cwd(), 'openapi/v1/openapi.json'), 'utf8')) as OpenAPIObject;
}

describe('OpenAPI runtime exposure', () => {
  it('keeps the machine-readable contract available without exposing Swagger UI in production', () => {
    const options = openApiSetupOptions(true);

    expect(options).toEqual(expect.objectContaining({
      ui: false,
      raw: ['json', 'yaml'],
      jsonDocumentUrl: '/api-json',
      yamlDocumentUrl: '/api-yaml',
    }));
    expect(options.swaggerOptions).toEqual(expect.objectContaining({ persistAuthorization: false }));
  });

  it('never persists bearer tokens in the development Swagger UI', () => {
    const options = openApiSetupOptions(false);

    expect(options.ui).toBe(true);
    expect(options.swaggerOptions).toEqual(expect.objectContaining({ persistAuthorization: false }));
  });

  it('supports cookie-only refresh bootstrap and keeps self-only fields out of public users', () => {
    const refresh = CLIENT_RESPONSE_SCHEMAS.RefreshDto;
    const publicUser = CLIENT_RESPONSE_SCHEMAS.PublicUserResponse;
    const authUser = CLIENT_RESPONSE_SCHEMAS.AuthUserResponse;

    expect(refresh.required).toBeUndefined();
    expect(refresh.additionalProperties).toBe(false);
    expect(publicUser.properties).not.toHaveProperty('email');
    expect(publicUser.properties).not.toHaveProperty('gender');
    expect(publicUser.properties).not.toHaveProperty('dateOfBirth');
    expect(authUser).toEqual(expect.objectContaining({
      additionalProperties: false,
      properties: expect.objectContaining({ email: expect.any(Object), gender: expect.any(Object), dateOfBirth: expect.any(Object) }),
    }));
  });

  it('covers the complete frontend operation inventory without duplicates, including every upload helper', () => {
    const keys = FRONTEND_OPERATION_CONTRACTS.map((contract) => `${contract.method.toUpperCase()} ${contract.path}`);
    const uploadContracts = FRONTEND_OPERATION_CONTRACTS.filter((contract) => contract.path.startsWith('/uploads/'));

    expect(FRONTEND_OPERATION_CONTRACTS).toHaveLength(185);
    expect(new Set(keys)).toHaveProperty('size', 185);
    expect(uploadContracts).toHaveLength(10);
    expect(uploadContracts.every((contract) => contract.request?.mediaType === 'multipart/form-data')).toBe(true);
    expect(() => assertValidOpenApiDocument(artifact())).not.toThrow();
  });

  it('fails closed when a consumed success, request, or error schema becomes a placeholder', () => {
    const successGap = artifact();
    const conversations = successGap.paths['/chat/conversations']?.get;
    if (!conversations || '$ref' in conversations.responses['200']!) throw new Error('Fixture operation missing');
    conversations.responses['200']!.content!['application/json']!.schema = { type: 'object', additionalProperties: true };
    expect(() => assertValidOpenApiDocument(successGap)).toThrow(/GET \/chat\/conversations response 200 lacks a concrete JSON schema/);

    const requestGap = artifact();
    requestGap.components!.schemas!.SendDirectMessageDto = { type: 'object', additionalProperties: true };
    expect(() => assertValidOpenApiDocument(requestGap)).toThrow(/POST \/chat\/requests has a missing or non-concrete request schema/);

    const errorGap = artifact();
    const operation = errorGap.paths['/chat/conversations']!.get!;
    if ('$ref' in operation.responses['500']!) throw new Error('Fixture response missing');
    operation.responses['500']!.content!['application/json']!.schema = { type: 'object', additionalProperties: true };
    expect(() => assertValidOpenApiDocument(errorGap)).toThrow(/GET \/chat\/conversations lacks concrete JSON error response 500/);
  });

  it('fails closed when an unconsumed operation loses its success schema', () => {
    const gap = artifact();
    const health = gap.paths['/health']?.get;
    if (!health || '$ref' in health.responses['200']!) throw new Error('Fixture operation missing');
    health.responses['200']!.content!['application/json']!.schema = { type: 'object', additionalProperties: true };

    expect(() => assertValidOpenApiDocument(gap)).toThrow(/GET \/health response 200 lacks a concrete JSON schema/);
  });

  it('fails closed when an object requires a property its schema does not declare', () => {
    const gap = artifact();
    const groupMessage = gap.components?.schemas?.GroupMessageResponse;
    if (!groupMessage || '$ref' in groupMessage) throw new Error('Fixture schema missing');
    groupMessage.required = [...(groupMessage.required ?? []), 'phantomProperty'];

    expect(() => assertValidOpenApiDocument(gap)).toThrow(
      /GroupMessageResponse requires undefined properties: phantomProperty/,
    );
  });

  it('publishes the same activity query and integration provider constraints enforced at runtime', () => {
    const document = artifact();
    expect(document.paths['/activities']?.get?.parameters).toContainEqual(expect.objectContaining({
      name: 'take',
      in: 'query',
      required: false,
      schema: expect.objectContaining({ type: 'integer', minimum: 1, maximum: 100 }),
    }));
    expect(document.paths['/activities/stats']?.get?.parameters).toContainEqual(expect.objectContaining({
      name: 'window',
      in: 'query',
      required: false,
      schema: expect.objectContaining({ type: 'string', enum: ['week', 'month', 'year', 'all'] }),
    }));
    for (const operation of [
      document.paths['/integrations/{provider}/oauth/start']?.get,
      document.paths['/integrations/{provider}']?.patch,
      document.paths['/integrations/{provider}']?.delete,
    ]) {
      expect(operation?.parameters).toContainEqual(expect.objectContaining({
        name: 'provider',
        in: 'path',
        required: true,
        schema: expect.objectContaining({ type: 'string', enum: ['strava', 'garmin'] }),
      }));
    }
  });

  it('publishes UUID formats for UUID-backed path parameters while preserving slug and provider routes', () => {
    const document = artifact();
    for (const [path, item] of Object.entries(document.paths)) {
      if (!item) continue;
      for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const operation = item[method];
        if (!operation) continue;
        for (const parameter of operation.parameters ?? []) {
          if ('$ref' in parameter || parameter.in !== 'path') continue;
          if (['slug', 'provider', 'code'].includes(parameter.name)) continue;
          if (path.startsWith('/users/{id}') && parameter.name === 'id') continue;
          expect(parameter.schema).toEqual(expect.objectContaining({ type: 'string', format: 'uuid' }));
        }
      }
    }
    expect(document.paths['/groups/{slug}']?.get?.parameters).toContainEqual(expect.objectContaining({
      name: 'slug',
      schema: expect.not.objectContaining({ format: 'uuid' }),
    }));
    expect(document.paths['/integrations/{provider}']?.patch?.parameters).toContainEqual(expect.objectContaining({
      name: 'provider',
      schema: expect.objectContaining({ enum: ['strava', 'garmin'] }),
    }));
    for (const operation of [
      document.paths['/users/{id}']?.get,
      document.paths['/users/{id}/followers']?.get,
      document.paths['/users/{id}/follow']?.post,
    ]) {
      expect(operation?.parameters).toContainEqual(expect.objectContaining({
        name: 'id',
        description: 'User UUID or username',
        schema: { type: 'string' },
      }));
    }
  });

  it('fails fast when two schema registries claim the same component name', () => {
    expect(() => assertNoDuplicateContractSchemas(
      { DuplicateResponse: { type: 'object', properties: { id: { type: 'string' } } } },
      { DuplicateResponse: { type: 'object', properties: { value: { type: 'string' } } } },
    )).toThrow(/one owner; duplicate names: DuplicateResponse/);
  });
});
