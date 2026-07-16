module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '\\.e2e-spec\\.ts$'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
};
