import { type Href } from 'expo-router';
import { NavigationCard } from '../../components/NavigationCard';
import { Screen } from '../../components/Screen';
import { BodyText, DemoBadge, SectionTitle } from '../../components/Visual';

const groups: { title: string; links: { label: string; href: Href }[] }[] = [
  {
    title: 'Acceso',
    links: [
      { label: 'Iniciar sesión', href: '/acceso' },
      { label: 'Crear cuenta', href: '/acceso/registro' },
      { label: 'Consentimientos de acceso', href: '/acceso/consentimientos' },
      { label: 'Recuperar contraseña', href: '/acceso/recuperar' },
      { label: 'Correo enviado', href: '/acceso/correo' },
      { label: 'Nueva contraseña', href: '/acceso/nueva-clave' },
    ],
  },
  {
    title: 'Inicio y perfil',
    links: [
      { label: 'Inicio con registro', href: '/' },
      { label: 'Inicio vacío', href: '/?vista=vacia' },
      { label: 'Mi perfil', href: '/perfil' },
      { label: 'Datos personales', href: '/perfil/datos' },
      { label: 'Perfil clínico', href: '/perfil/clinico' },
      { label: 'Preferencias', href: '/perfil/preferencias' },
      { label: 'Consentimientos del perfil', href: '/perfil/consentimientos' },
      { label: 'Código de vinculación', href: '/perfil/vinculacion' },
      { label: 'Código no disponible', href: '/perfil/vinculacion?estado=sin-codigo' },
      { label: 'Vínculo establecido', href: '/perfil/vinculacion?estado=vinculado' },
    ],
  },
  {
    title: 'Vitales y reportes',
    links: [
      { label: 'Historial', href: '/vitales' },
      { label: 'Historial vacío', href: '/vitales?vista=vacia' },
      { label: 'Historial cargando', href: '/vitales?vista=cargando' },
      { label: 'Historial con error', href: '/vitales?vista=error' },
      { label: 'Historial sin conexión', href: '/vitales?vista=sin-conexion' },
      { label: 'Pendiente de sincronización', href: '/vitales?vista=pendiente' },
      { label: 'Sincronizando', href: '/vitales?vista=sincronizando' },
      { label: 'Sincronizado', href: '/vitales?vista=sincronizado' },
      { label: 'Detalle de registro', href: '/vitales/detalle' },
      { label: 'Registrar vitales', href: '/vitales/registrar' },
      { label: 'Registro guardado', href: '/vitales/resultado-guardado' },
      { label: 'Evaluación sin alertas', href: '/vitales/estado-normal' },
      { label: 'Estado de atención', href: '/vitales/estado-atencion' },
      { label: 'Atención prioritaria', href: '/vitales/estado-prioritario' },
      { label: 'Reportes', href: '/vitales/reportes' },
      { label: 'Reporte preparando', href: '/vitales/reporte-estado?estado=preparando' },
      { label: 'Reporte disponible', href: '/vitales/reporte-estado?estado=disponible' },
      { label: 'Reporte con error', href: '/vitales/reporte-estado?estado=error' },
    ],
  },
  {
    title: 'Síntomas',
    links: [
      { label: 'Formulario por secciones', href: '/formulario' },
      { label: 'Resumen', href: '/formulario/resumen' },
      { label: 'Resultado de ejemplo', href: '/formulario/resultado' },
    ],
  },
  {
    title: 'Educación',
    links: [
      { label: 'Categorías', href: '/educacion' },
      { label: 'Recursos de categoría', href: '/educacion/categoria' },
      { label: 'Video', href: '/educacion/recurso?recurso=0' },
      { label: 'Infografía descargada', href: '/educacion/recurso?recurso=1' },
      { label: 'Recurso pendiente', href: '/educacion/recurso?recurso=2' },
      { label: 'Biblioteca vacía', href: '/educacion/estado?estado=vacia' },
      { label: 'Biblioteca cargando', href: '/educacion/estado?estado=cargando' },
      { label: 'Biblioteca con error', href: '/educacion/estado?estado=error' },
      { label: 'Recurso sin conexión', href: '/educacion/estado?estado=sin-conexion' },
    ],
  },
  {
    title: 'Asistente',
    links: [
      { label: 'Conversación de ejemplo', href: '/asistente' },
      { label: 'En espera', href: '/asistente?estado=espera' },
      { label: 'Error', href: '/asistente?estado=error' },
      { label: 'Sin conexión', href: '/asistente?estado=sin-conexion' },
    ],
  },
];

export function GalleryScreen() {
  if (!__DEV__)
    return (
      <Screen title="Galería" backTo="/">
        <BodyText>Disponible durante desarrollo.</BodyText>
      </Screen>
    );
  return (
    <Screen title="Galería de revisión" backTo="/">
      <DemoBadge />
      <BodyText>
        Abre cada pantalla para revisar diseño y estados. Los datos y resultados son ficticios.
      </BodyText>
      {groups.map((group) => (
        <Section key={group.title} title={group.title} links={group.links} />
      ))}
    </Screen>
  );
}

function Section({ title, links }: { title: string; links: { label: string; href: Href }[] }) {
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      {links.map((link) => (
        <NavigationCard key={link.label} title={link.label} icon="grid" href={link.href} />
      ))}
    </>
  );
}
