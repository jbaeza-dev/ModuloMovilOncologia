/// <reference types="jest" />
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
const mockLaunch = jest.fn();
jest.mock('../features/education/podcasts', () => ({
  ...jest.requireActual('../features/education/podcasts'),
  launchPodcast: (id: string) => mockLaunch(id),
}));
jest.mock('../components/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({ theme: { colors: { error: '#b00020' } } }),
}));
jest.mock('../components/Visual', () => {
  const { Text, View, Pressable } = jest.requireActual('react-native');
  return {
    BodyText: Text,
    InfoCard: View,
    SectionTitle: Text,
    StatusPill: Text,
    VisualButton: ({
      label,
      disabled,
      onPress,
    }: {
      label: string;
      disabled?: boolean;
      onPress: () => void;
    }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={onPress}
      >
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});
import { PodcastsScreen } from '../features/education/PodcastsScreen';
describe('Online podcast screen', () => {
  it('offers four accessible episode actions and explains an offline failure without hiding them', async () => {
    mockLaunch.mockResolvedValue({
      opened: false,
      error: 'Este podcast requiere conexión a internet.',
    });
    await render(<PodcastsScreen />);
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByText(/los audios no se guardan/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Escuchar: El Cáncer' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/requiere conexión/));
    expect(screen.getByRole('button', { name: 'Escuchar: Signos de Alarma' })).toBeTruthy();
  });
});
