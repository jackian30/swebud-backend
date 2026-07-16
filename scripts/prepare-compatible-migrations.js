const { spawn } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const COMPATIBILITY_MIGRATIONS = [
  '20260716143000_drop_chat_private_key',
  '20260716161000_coalesce_pending_message_requests',
];

function resolutionActions(row) {
  if (row?.finished_at && !row.rolled_back_at) return [];
  if (row && !row.finished_at && !row.rolled_back_at) return ['rolled-back', 'applied'];
  return ['applied'];
}

function runResolve(action, migration, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      ['prisma', 'migrate', 'resolve', `--${action}`, migration],
      { stdio: 'inherit', env },
    );
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function migrationRows(prisma) {
  try {
    return await prisma.$queryRawUnsafe(`
      SELECT migration_name, finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name IN ('${COMPATIBILITY_MIGRATIONS.join("','")}')
      ORDER BY started_at DESC
    `);
  } catch (error) {
    // PostgreSQL 42P01 means a fresh database has no migration table yet.
    if (error?.meta?.code === '42P01' || String(error?.message).includes('_prisma_migrations')) return [];
    throw error;
  }
}

async function prepareCompatibilityMigrations({ prisma = new PrismaClient(), env = process.env, resolve = runResolve } = {}) {
  try {
    const rows = await migrationRows(prisma);
    for (const migration of COMPATIBILITY_MIGRATIONS) {
      const row = rows.find((candidate) => candidate.migration_name === migration && !candidate.rolled_back_at)
        ?? rows.find((candidate) => candidate.migration_name === migration);
      for (const action of resolutionActions(row)) {
        console.log(`Recording compatibility migration ${migration} as ${action}.`);
        const code = await resolve(action, migration, env);
        if (code !== 0) throw new Error(`prisma migrate resolve failed for ${migration} (${action}) with exit code ${code}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  prepareCompatibilityMigrations().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  COMPATIBILITY_MIGRATIONS,
  prepareCompatibilityMigrations,
  resolutionActions,
};
