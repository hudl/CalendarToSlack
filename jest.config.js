module.exports = {
  roots: ['<rootDir>/src'],
  modulePaths: ['<rootDir>'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  clearMocks: true,
};
