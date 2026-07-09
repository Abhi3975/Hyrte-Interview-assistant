/** Jest config for the API. Unit tests live under test/ and cover the pure
 *  domain logic (risk scoring, licensing, plagiarism) with no DB/network. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/**/*.ts'],
};
