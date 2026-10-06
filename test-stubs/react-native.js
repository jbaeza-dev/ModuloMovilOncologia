// Stub minimal para evitar que Vite intente transpilar Flow syntax de react-native en Vitest (Node)
module.exports = {
  Platform: { OS: 'android', select: (objs) => objs.android || objs.default },
};
