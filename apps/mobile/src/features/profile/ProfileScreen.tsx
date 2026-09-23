import { NavigationCard } from '../../components/NavigationCard';
import { Screen } from '../../components/Screen';

export function ProfileScreen() {
  return (
    <Screen title="Mi perfil" backTo="/">
      <NavigationCard
        title="Perfil clínico"
        description="Información de tu tratamiento de quimioterapia."
        icon="file-text"
        href="/perfil/clinico"
      />
      <NavigationCard
        title="Código de vinculación"
        description="Vinculación con tu equipo de salud."
        icon="link"
        href="/perfil/vinculacion"
      />
      <NavigationCard
        title="Preferencias"
        description="Opciones de la aplicación."
        icon="settings"
        href="/perfil/preferencias"
      />
    </Screen>
  );
}
