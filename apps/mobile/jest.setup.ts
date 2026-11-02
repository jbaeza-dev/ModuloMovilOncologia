// Mock global nativo para expo-audio en entorno de pruebas Jest
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
  createAudioPlayer: () => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn().mockResolvedValue(undefined),
    setPlaybackRate: jest.fn(),
    setActiveForLockScreen: jest.fn(),
    remove: jest.fn(),
    addListener: jest.fn(),
  }),
  useAudioPlayer: jest.fn(),
  useAudioPlayerStatus: jest.fn().mockReturnValue({ playing: false, currentTime: 0, duration: 0 }),
}));

// Mock nativo para expo-screen-orientation
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn().mockResolvedValue(undefined),
  unlockAsync: jest.fn().mockResolvedValue(undefined),
  OrientationLock: {
    DEFAULT: 0,
    ALL: 1,
    PORTRAIT: 2,
    PORTRAIT_UP: 3,
    PORTRAIT_DOWN: 4,
    LANDSCAPE: 5,
    LANDSCAPE_LEFT: 6,
    LANDSCAPE_RIGHT: 7,
  },
}));
