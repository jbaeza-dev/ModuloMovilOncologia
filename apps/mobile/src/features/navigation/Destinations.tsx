import { DestinationScreen } from '../../components/DestinationScreen';
import { NavigationCard } from '../../components/NavigationCard';

export function VitalsScreen() {
  return (
    <DestinationScreen
      title="Historial de signos vitales"
      icon="activity"
      description="Aquí podrás consultar las mediciones que registres y su estado de sincronización."
    >
      <NavigationCard
        title="Registrar signos vitales"
        icon="plus"
        href="/vitales/registrar"
        primary
      />
    </DestinationScreen>
  );
}

export function RegisterVitalsScreen() {
  return (
    <DestinationScreen
      title="Registrar signos vitales"
      icon="edit-3"
      description="Aquí podrás registrar tus mediciones para el seguimiento diario."
      backTo="/vitales"
    />
  );
}

export function FormScreen() {
  return (
    <DestinationScreen
      title="Síntomas de hoy"
      icon="clipboard"
      description="Aquí podrás responder el formulario de síntomas de tu tratamiento de quimioterapia."
    />
  );
}

export function EducationScreen() {
  return (
    <DestinationScreen
      title="Contenido educativo"
      icon="book-open"
      description="Aquí encontrarás recursos sobre quimioterapia y cuidados durante tu tratamiento."
    />
  );
}

export function ClinicalProfileScreen() {
  return (
    <DestinationScreen
      title="Perfil clínico"
      icon="file-text"
      description="Aquí podrás consultar la información disponible sobre tu tratamiento de quimioterapia."
      backTo="/perfil"
    />
  );
}

export function LinkCodeScreen() {
  return (
    <DestinationScreen
      title="Código de vinculación"
      icon="link"
      description="Aquí podrás consultar tu código de vinculación cuando esté disponible."
      notice="Comparte tu código únicamente con tu equipo de salud."
      backTo="/perfil"
    />
  );
}

export function PreferencesScreen() {
  return (
    <DestinationScreen
      title="Preferencias"
      icon="settings"
      description="Aquí encontrarás las preferencias de la aplicación cuando estén disponibles."
      backTo="/perfil"
    />
  );
}

export function AssistantScreen() {
  return (
    <DestinationScreen
      title="Asistente QuimioCare"
      icon="message-circle"
      description="Este espacio ofrecerá orientación sobre quimioterapia y cuidados."
      notice="El asistente ofrece orientación; no realiza diagnósticos ni prescribe tratamientos. No sustituye la atención de tu equipo de salud."
      backTo="/"
    />
  );
}
