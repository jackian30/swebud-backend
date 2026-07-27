const { deployMigrations } = require('./render-start');

async function main() {
  await deployMigrations(process.env);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = { main };
