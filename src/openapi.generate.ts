import { Test } from '@nestjs/testing';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { AppModule } from './app.module';
import { buildOpenApiDocument } from './openapi';
import { PrismaService } from './prisma/prisma.service';
import { LocalStorageDriver } from './uploads/media-library/local-storage.driver';

async function generate() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(LocalStorageDriver)
    .useValue({})
    .compile();
  const app = moduleRef.createNestApplication();
  try {
    const document = buildOpenApiDocument(app);
    const serialized = `${JSON.stringify(document, null, 2)}\n`;
    const output = join(process.cwd(), 'openapi/v1/openapi.json');
    if (process.env.OPENAPI_CHECK === '1') {
      const committed = await readFile(output, 'utf8').catch(() => '');
      if (committed !== serialized) {
        throw new Error('Backend OpenAPI artifact is stale. Run npm run openapi:generate and commit openapi/v1/openapi.json.');
      }
      process.stdout.write(`OpenAPI artifact is current: ${output}\n`);
      return;
    }
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serialized, 'utf8');
    process.stdout.write(`OpenAPI artifact written: ${output}\n`);
  } finally {
    await app.close();
  }
}

void generate().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
