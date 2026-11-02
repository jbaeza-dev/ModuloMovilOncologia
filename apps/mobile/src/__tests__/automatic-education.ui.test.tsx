/// <reference types="jest" />
import React from 'react';
import { Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import {
  AutomaticEducationDownloads,
  useAutomaticEducationStatus,
} from '../features/education/AutomaticEducationDownloads';

const mockRun = jest.fn();
jest.mock('../features/education/bulk-download-coordinator', () => ({
  runBulkInfographicDownload: (...args: unknown[]) => mockRun(...args),
}));
jest.mock('../features/education/replicated-education-reader', () => ({
  createReplicatedEducationReader: () => ({}),
}));
jest.mock('expo-network', () => ({ addNetworkStateListener: () => ({ remove: jest.fn() }) }));
const mockRepository = { replicatedCatalog: { status: jest.fn(), education: jest.fn() } };
const mockTrack = (work: () => Promise<unknown>) => work();
let mockClosing = false;
jest.mock('../providers/LocalDataProvider', () => ({
  useLocalData: () => ({
    patientId: 'patient-a',
    repository: mockRepository,
    database: mockDatabase,
    isClosing: mockClosing,
    trackOperation: mockTrack,
  }),
}));
// Stable connection identity, as in the actual provider.
const mockDatabase = {};
beforeEach(() => {
  mockClosing = false;
  mockRun.mockReset().mockResolvedValue({ failed: 0, cancelled: false });
  mockRepository.replicatedCatalog.status.mockResolvedValue({
    completed_at: '2026-11-02T12:00:00Z',
    error_code: null,
  });
  mockRepository.replicatedCatalog.education.mockResolvedValue([
    { id: 'image', archivo_revision: 'one' },
  ]);
});
function Status() {
  return <Text>{useAutomaticEducationStatus() ?? 'waiting'}</Text>;
}

it('prepares educational files from the app root without opening the library or pressing a button', async () => {
  await render(
    <AutomaticEducationDownloads>
      <Status />
    </AutomaticEducationDownloads>,
  );
  await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(1));
  expect(mockRun).toHaveBeenCalledWith(
    expect.objectContaining({
      patientId: 'patient-a',
      repository: mockRepository,
      signal: expect.any(AbortSignal),
    }),
  );
  await screen.findByText('ready');
});

it('cancels the pending file request when the account starts closing', async () => {
  let finish!: (result: { failed: number; cancelled: boolean }) => void;
  mockRun.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(
    <AutomaticEducationDownloads>
      <Status />
    </AutomaticEducationDownloads>,
  );
  await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(1));
  const signal = mockRun.mock.calls[0][0].signal as AbortSignal;
  mockClosing = true;
  await screen.rerender(
    <AutomaticEducationDownloads>
      <Status />
    </AutomaticEducationDownloads>,
  );
  expect(signal.aborted).toBe(true);
  finish({ failed: 0, cancelled: true });
});
