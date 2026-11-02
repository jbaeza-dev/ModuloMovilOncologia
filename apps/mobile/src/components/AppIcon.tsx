import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { OFFICIAL_ICONS } from './official-icons';

type Props = ComponentProps<typeof Feather>;
const aliases: Partial<Record<Props['name'], keyof typeof OFFICIAL_ICONS>> = {
  home: 'inicio',
  activity: 'signos-vitales',
  thermometer: 'temperatura',
  heart: 'pulso',
  clock: 'recordatorios',
  clipboard: 'sintomas',
  'book-open': 'educacion',
  'file-text': 'reportes',
  'share-2': 'compartir',
  download: 'descargar',
  printer: 'imprimir',
  'link-2': 'vincular',
  users: 'equipo-salud',
  user: 'perfil',
  'user-check': 'cuidador',
  wifi: 'conexion',
  'wifi-off': 'sin-conexion',
  'refresh-cw': 'sincronizar',
  send: 'enviar',
  'check-circle': 'confirmacion',
  'alert-circle': 'alertas',
  'alert-triangle': 'alertas',
  'help-circle': 'ayuda',
  settings: 'configuracion',
  shield: 'privacidad',
  bell: 'notificaciones',
  search: 'buscar',
  'arrow-left': 'volver',
  'chevron-right': 'siguiente',
  x: 'cerrar',
  plus: 'anadir',
  'edit-2': 'editar',
  'trash-2': 'eliminar',
  filter: 'filtro',
  'log-out': 'salir',
  play: 'reproducir',
  pause: 'pausa',
  calendar: 'calendario',
  list: 'lista',
  info: 'informacion',
  copy: 'copia',
  eye: 'ojo',
  'message-square': 'asistente',
  'message-circle': 'asistente',
  paperclip: 'medicamentos',
};

/** Formas oficiales; Feather solo cubre acciones sin equivalente en el catálogo. */
export function AppIcon(props: Props) {
  const id = aliases[props.name];
  if (!id) return <Feather {...props} />;
  const size = props.size ?? 24;
  return (
    <Image
      source={OFFICIAL_ICONS[id]}
      resizeMode="contain"
      accessible={props.accessible ?? false}
      accessibilityLabel={props.accessibilityLabel}
      testID={props.testID}
      style={[
        { width: size, height: size, tintColor: props.color },
        props.style as StyleProp<ImageStyle>,
      ]}
    />
  );
}
