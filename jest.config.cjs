module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests/unit'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js'],
};
