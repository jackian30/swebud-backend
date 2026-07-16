import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerCustomOptions, SwaggerModule } from '@nestjs/swagger';
import { appVersion } from './common/app-version';
import { applyClientContract, FRONTEND_JSON_CONTRACTS, FRONTEND_REQUEST_CONTRACTS, operationAt } from './openapi.contract';
import { FRONTEND_OPERATION_CONTRACTS } from './openapi.operations';
import type { ReferenceObject, SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

const REQUIRED_CLIENT_PATHS = [
  '/auth/register',
  '/auth/login',
  '/auth/refresh',
  '/users/me',
  '/feed',
  '/posts',
  '/groups',
  '/groups/{id}/channels/{channelId}/messages',
  '/chat/conversations',
  '/buddy/rooms',
  '/actsnaps',
  '/notifications',
  '/theme',
] as const;

export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('SweBudd API')
    .setDescription('Authoritative HTTP API contract for SweBudd clients.')
    .setVersion(appVersion())
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) => `${controllerKey}_${methodKey}`,
  });
  applyClientContract(document);
  assertValidOpenApiDocument(document);
  return document;
}

export function setupOpenApi(app: INestApplication) {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('docs', app, document, openApiSetupOptions(process.env.NODE_ENV === 'production'));
  return document;
}

export function openApiSetupOptions(production: boolean): SwaggerCustomOptions {
  return {
    ui: !production,
    raw: ['json', 'yaml'],
    jsonDocumentUrl: '/api-json',
    yamlDocumentUrl: '/api-yaml',
    customSiteTitle: 'SweBudd API',
    swaggerOptions: { persistAuthorization: false },
  };
}

export function assertValidOpenApiDocument(document: OpenAPIObject) {
  if (!document.openapi?.startsWith('3.')) throw new Error('OpenAPI generation did not produce an OpenAPI 3 document.');
  const paths = Object.keys(document.paths ?? {});
  if (paths.length < 50) throw new Error(`OpenAPI generation found only ${paths.length} paths; controller discovery is incomplete.`);
  const missing = REQUIRED_CLIENT_PATHS.filter((path) => !document.paths[path]);
  if (missing.length) throw new Error(`OpenAPI is missing required client paths: ${missing.join(', ')}`);
  assertRequiredPropertiesDeclared(document);

  for (const [path, item] of Object.entries(document.paths)) {
    if (!item) throw new Error(`OpenAPI path ${path} has no path item.`);
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = item[method];
      if (!operation) continue;
      if (!operation.operationId) throw new Error(`OpenAPI operation ${method.toUpperCase()} ${path} has no operationId.`);
      if (!Object.keys(operation.responses ?? {}).length) throw new Error(`OpenAPI operation ${method.toUpperCase()} ${path} has no responses.`);
      const successResponses = Object.entries(operation.responses ?? {}).filter(([status]) => /^2\d\d$/.test(status));
      if (!successResponses.length) throw new Error(`OpenAPI operation ${method.toUpperCase()} ${path} has no success response.`);
      for (const [status, response] of successResponses) {
        if (!response || '$ref' in response) {
          throw new Error(`OpenAPI operation ${method.toUpperCase()} ${path} response ${status} lacks a concrete JSON schema.`);
        }
        if (status === '204' && !response.content) continue;
        if (!schemaIsConcrete(document, response.content?.['application/json']?.schema)) {
          throw new Error(`OpenAPI operation ${method.toUpperCase()} ${path} response ${status} lacks a concrete JSON schema.`);
        }
      }
    }
  }

  for (const contract of FRONTEND_JSON_CONTRACTS) {
    const operation = operationAt(document, contract.path, contract.method);
    if (!operation) throw new Error(`OpenAPI is missing frontend operation ${contract.method.toUpperCase()} ${contract.path}.`);
    const response = operation.responses[contract.status];
    if (!response || '$ref' in response) throw new Error(`OpenAPI frontend operation ${contract.method.toUpperCase()} ${contract.path} is missing response ${contract.status}.`);
    const schema = response.content?.['application/json']?.schema;
    if (!schema || (!('$ref' in schema) && !schema.type && !schema.allOf && !schema.oneOf && !schema.anyOf)) {
      throw new Error(`OpenAPI frontend operation ${contract.method.toUpperCase()} ${contract.path} response ${contract.status} lacks a concrete application/json schema.`);
    }
  }

  for (const contract of FRONTEND_REQUEST_CONTRACTS) {
    const operation = operationAt(document, contract.path, contract.method);
    if (!operation) throw new Error(`OpenAPI is missing frontend operation ${contract.method.toUpperCase()} ${contract.path}.`);
    const requestBody = operation.requestBody;
    if (!requestBody || '$ref' in requestBody) throw new Error(`OpenAPI frontend operation ${contract.method.toUpperCase()} ${contract.path} lacks an application/json request body.`);
    const schema = requestBody.content?.['application/json']?.schema;
    if (!schema || !('$ref' in schema)) throw new Error(`OpenAPI frontend operation ${contract.method.toUpperCase()} ${contract.path} request body lacks a named schema.`);
    const schemaName = schema.$ref.split('/').pop() ?? '';
    const concrete = document.components?.schemas?.[schemaName];
    if (!concrete || '$ref' in concrete || (!concrete.properties && !concrete.allOf && concrete.additionalProperties !== true)) {
      throw new Error(`OpenAPI frontend operation ${contract.method.toUpperCase()} ${contract.path} request schema ${schemaName} is not concrete.`);
    }
  }

  const operationKeys = new Set<string>();
  for (const contract of FRONTEND_OPERATION_CONTRACTS) {
    const key = `${contract.method.toUpperCase()} ${contract.path}`;
    if (operationKeys.has(key)) throw new Error(`OpenAPI frontend operation inventory contains duplicate ${key}.`);
    operationKeys.add(key);
    const operation = operationAt(document, contract.path, contract.method);
    if (!operation) throw new Error(`OpenAPI is missing consumed frontend operation ${key}.`);

    const successResponses = Object.entries(operation.responses ?? {}).filter(([status]) => /^2\d\d$/.test(status));
    if (!successResponses.length) throw new Error(`OpenAPI consumed frontend operation ${key} has no success response.`);
    for (const [status, response] of successResponses) {
      if (!response) throw new Error(`OpenAPI consumed frontend operation ${key} has an empty response ${status}.`);
      if ('$ref' in response) throw new Error(`OpenAPI consumed frontend operation ${key} has unresolved response ${status}.`);
      if (contract.responseSchema === null) {
        if (status !== '204' || response.content) {
          throw new Error(`OpenAPI consumed frontend operation ${key} must use an empty 204 response.`);
        }
        continue;
      }
      const schema = response.content?.['application/json']?.schema;
      if (!schemaIsConcrete(document, schema)) {
        throw new Error(`OpenAPI consumed frontend operation ${key} response ${status} lacks a concrete JSON schema.`);
      }
      if (!('$ref' in schema!) || schema!.$ref !== `#/components/schemas/${contract.responseSchema}`) {
        throw new Error(`OpenAPI consumed frontend operation ${key} response ${status} is not bound to ${contract.responseSchema}.`);
      }
    }

    const requestBody = operation.requestBody;
    if (requestBody && !('$ref' in requestBody)) {
      const requestSchemas = Object.entries(requestBody.content ?? {}).map(([mediaType, media]) => [mediaType, media.schema] as const);
      if (!requestSchemas.length || requestSchemas.some(([, schema]) => !schemaIsConcrete(document, schema))) {
        throw new Error(`OpenAPI consumed frontend operation ${key} has a missing or non-concrete request schema.`);
      }
    }
    if (contract.request) {
      if (!requestBody || '$ref' in requestBody) throw new Error(`OpenAPI consumed frontend operation ${key} is missing its request body.`);
      const mediaType = contract.request.mediaType ?? 'application/json';
      const schema = requestBody.content?.[mediaType]?.schema;
      if (!schemaIsConcrete(document, schema)) throw new Error(`OpenAPI consumed frontend operation ${key} has no concrete ${mediaType} request schema.`);
    }

    for (const status of ['400', ...(operation.security?.length ? ['401'] : []), '403', '409', '429', '500']) {
      const errorResponse = operation.responses[status];
      if (!errorResponse || '$ref' in errorResponse || !schemaIsConcrete(document, errorResponse.content?.['application/json']?.schema)) {
        throw new Error(`OpenAPI consumed frontend operation ${key} lacks concrete JSON error response ${status}.`);
      }
    }
  }

  assertSecurity(document, '/auth/login', 'post', false);
  assertSecurity(document, '/health', 'get', false);
  assertSecurity(document, '/users/me', 'get', true);
  assertSecurity(document, '/groups', 'get', true);
}

function schemaIsConcrete(
  document: OpenAPIObject,
  schema: SchemaObject | ReferenceObject | undefined,
  seen = new Set<string>(),
): boolean {
  if (!schema) return false;
  if ('$ref' in schema) {
    if (!schema.$ref.startsWith('#/components/schemas/')) return false;
    if (seen.has(schema.$ref)) return true;
    const name = schema.$ref.split('/').pop() ?? '';
    const resolved = document.components?.schemas?.[name];
    return Boolean(resolved && schemaIsConcrete(document, resolved, new Set([...seen, schema.$ref])));
  }
  if (schema.enum?.length || schema.type && schema.type !== 'object' && schema.type !== 'array') return true;
  const variants = schema.oneOf ?? schema.anyOf ?? schema.allOf;
  if (variants) return variants.length > 0 && variants.every((variant) => schemaIsConcrete(document, variant, seen));
  if (schema.type === 'array') return schemaIsConcrete(document, schema.items, seen);
  const properties = Object.values(schema.properties ?? {});
  if (properties.length) return properties.every((property) => schemaIsConcrete(document, property, seen));
  if (schema.additionalProperties === true && (schema as SchemaObject & { 'x-swebudd-arbitrary-json'?: boolean })['x-swebudd-arbitrary-json']) {
    return true;
  }
  if (schema.additionalProperties && schema.additionalProperties !== true) {
    return schemaIsConcrete(document, schema.additionalProperties, seen);
  }
  return false;
}

function assertRequiredPropertiesDeclared(document: OpenAPIObject) {
  const availableProperties = (
    schema: SchemaObject | ReferenceObject,
    seen = new Set<string>(),
  ): Set<string> => {
    if ('$ref' in schema) {
      if (seen.has(schema.$ref) || !schema.$ref.startsWith('#/components/schemas/')) return new Set();
      const name = schema.$ref.split('/').pop() ?? '';
      const resolved = document.components?.schemas?.[name];
      return resolved ? availableProperties(resolved, new Set([...seen, schema.$ref])) : new Set();
    }
    const names = new Set(Object.keys(schema.properties ?? {}));
    for (const branch of schema.allOf ?? []) {
      for (const name of availableProperties(branch, seen)) names.add(name);
    }
    return names;
  };

  const visit = (
    schema: SchemaObject | ReferenceObject,
    location: string,
    inherited = new Set<string>(),
  ) => {
    if ('$ref' in schema) return;
    const available = new Set([...inherited, ...availableProperties(schema)]);
    const unknownRequired = (schema.required ?? []).filter((name) => !available.has(name));
    if (unknownRequired.length) {
      throw new Error(`${location} requires undefined properties: ${unknownRequired.join(', ')}`);
    }

    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      visit(property, `${location}.properties.${name}`);
    }
    if (schema.items) visit(schema.items, `${location}.items`);
    if (schema.additionalProperties && schema.additionalProperties !== true) {
      visit(schema.additionalProperties, `${location}.additionalProperties`);
    }
    for (const [index, branch] of (schema.allOf ?? []).entries()) {
      visit(branch, `${location}.allOf[${index}]`, available);
    }
    for (const keyword of ['oneOf', 'anyOf'] as const) {
      for (const [index, branch] of (schema[keyword] ?? []).entries()) {
        visit(branch, `${location}.${keyword}[${index}]`, new Set([...inherited, ...Object.keys(schema.properties ?? {})]));
      }
    }
  };

  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    visit(schema, `#/components/schemas/${name}`);
  }
}

function assertSecurity(document: OpenAPIObject, path: string, method: 'get' | 'post', protectedOperation: boolean) {
  const operation = operationAt(document, path, method);
  if (!operation) throw new Error(`OpenAPI security validation is missing ${method.toUpperCase()} ${path}.`);
  const bearerRequired = Boolean(operation.security?.some((requirement) => Object.prototype.hasOwnProperty.call(requirement, 'bearer')));
  if (bearerRequired !== protectedOperation) {
    throw new Error(`OpenAPI security is incorrect for ${method.toUpperCase()} ${path}; expected ${protectedOperation ? 'bearer protected' : 'public'}.`);
  }
}
