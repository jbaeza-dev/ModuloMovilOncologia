module.exports = {
  Asset: {
    loadAsync: async () => [
      { localUri: 'file:///stub.png', uri: 'file:///stub.png', downloaded: true },
    ],
    fromModule: () => ({ uri: 'file:///stub.png', localUri: 'file:///stub.png' }),
  },
};
