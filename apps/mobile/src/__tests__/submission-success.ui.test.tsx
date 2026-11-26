/// <reference types="jest" />
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
jest.mock('../components/AppIcon', () => ({ AppIcon: () => null }));
import {
  SUBMISSION_SUCCESS_MS,
  SubmissionSuccessModal,
} from '../features/medical-forms/SubmissionSuccessModal';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('Confirmación del cuestionario enviado', () => {
  it('queda a la vista el tiempo suficiente para leerla y luego se cierra sola', async () => {
    const onDone = jest.fn();
    await render(<SubmissionSuccessModal visible onDone={onDone} />);
    expect(screen.getByText('¡Cuestionario enviado!')).toBeTruthy();
    expect(SUBMISSION_SUCCESS_MS).toBeGreaterThanOrEqual(4000);
    await act(async () => {
      jest.advanceTimersByTime(1400);
    });
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(SUBMISSION_SUCCESS_MS - 1400);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('al tocarla se cierra antes, una sola vez aunque después se cumpla el tiempo', async () => {
    const onDone = jest.fn();
    await render(<SubmissionSuccessModal visible onDone={onDone} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar confirmación' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar confirmación' }));
    await act(async () => {
      jest.advanceTimersByTime(SUBMISSION_SUCCESS_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('si está oculta no programa ningún cierre', async () => {
    const onDone = jest.fn();
    await render(<SubmissionSuccessModal visible={false} onDone={onDone} />);
    await act(async () => {
      jest.advanceTimersByTime(SUBMISSION_SUCCESS_MS * 2);
    });
    expect(onDone).not.toHaveBeenCalled();
  });
});
