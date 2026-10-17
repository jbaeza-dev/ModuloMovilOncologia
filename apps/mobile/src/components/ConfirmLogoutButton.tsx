import { useRef } from 'react';
import { Alert } from 'react-native';

import { useLocalData } from '../providers/LocalDataProvider';
import { VisualButton } from './Visual';

export interface ConfirmLogoutButtonProps {
  label?: string;
  secondary?: boolean;
}

export const LOGOUT_CONFIRM_TITLE = '¿Cerrar sesión?';
export const LOGOUT_CONFIRM_MESSAGE =
  'Tus registros y horarios se conservarán en este dispositivo. Los avisos de este paciente se suspenderán al cerrar sesión.';

export function ConfirmLogoutButton({
  label = 'Cerrar sesión',
  secondary = true,
}: ConfirmLogoutButtonProps) {
  const { closeActiveContext, isClosing } = useLocalData();
  const inProgressRef = useRef(false);

  const handlePress = () => {
    if (isClosing || inProgressRef.current) return;

    Alert.alert(LOGOUT_CONFIRM_TITLE, LOGOUT_CONFIRM_MESSAGE, [
      {
        text: 'Cancelar',
        style: 'cancel',
      },
      {
        text: 'Cerrar sesión',
        style: 'destructive',
        onPress: () => {
          if (isClosing || inProgressRef.current) return;
          inProgressRef.current = true;
          void Promise.resolve(closeActiveContext('manual_close')).finally(() => {
            inProgressRef.current = false;
          });
        },
      },
    ]);
  };

  return (
    <VisualButton
      label={isClosing ? 'Cerrando sesión…' : label}
      secondary={secondary}
      disabled={isClosing}
      onPress={handlePress}
    />
  );
}
