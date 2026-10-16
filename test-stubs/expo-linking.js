module.exports = {
  canOpenURL: async (_url) => false,
  openURL: async (_url) => {},
  createURL: (path) => path,
  addEventListener: () => ({ remove: () => {} }),
};
