module.exports = {
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.tsx?$': '@swc/jest',
  },
  clearMocks: true,
};
