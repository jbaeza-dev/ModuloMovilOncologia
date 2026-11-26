/**
 * patient-copy.ts
 *
 * Diccionario de Lenguaje Claro y Textos Amigables para Pacientes y Cuidadores de QuimioCare.
 * Prohíbe terminología técnica de ingeniería (OAuth, PowerSync, SQLite, SheetJS, FileCipher, lease, HTTP 403)
 * y proporciona frases comprensibles, empáticas y adaptadas a personas bajo fatiga por tratamiento.
 */

export const APP_IDENTITY = {
  name: 'QuimioCare',
  tagline: 'Contigo, también en casa.',
  descriptor: 'Acompañamiento durante la quimioterapia',
  mascotName: 'Casita QuimioCare',
} as const;

export const SYNC_AND_STORAGE_COPY = {
  savedLocally: 'Guardado en este teléfono',
  pendingUpload: 'Pendiente de envío a tu equipo médico',
  syncedWithServer: 'Recibido por tu equipo de salud',
  offlineNotice:
    'Sin conexión a internet. Tus registros quedan guardados de forma segura en este teléfono y se enviarán automáticamente al reconectar.',
  firstSync: 'Actualizando tu información clínica por primera vez…',
  storageProtected: 'Tus datos médicos están protegidos y cifrados en la memoria de este teléfono.',
  isolatedUserStorage:
    'Cada cuenta mantiene su propia información aislada y protegida en este dispositivo.',
} as const;

export const AUTH_AND_ONBOARDING_COPY = {
  loginTitle: 'Ingreso de paciente',
  loginSubtitle: 'Accede de forma segura para revisar tu tratamiento y acompañamiento en casa.',
  googleLogin: 'Entrar con mi cuenta de Google',
  completingProfile: 'Completar mis datos para continuar',
  profileRequiredNotice:
    'Necesitamos algunos datos básicos de salud para vincular tu ficha de acompañamiento domiciliario.',
  consentsTitle: 'Consentimientos informados y términos',
  consentsRequired:
    'Para brindarte acompañamiento seguro en casa, revisa y autoriza los términos de uso y privacidad.',
  sessionClosing: 'Cerrando sesión de forma segura…',
  sessionClosedNotice:
    'Tu sesión ha sido cerrada. Ninguna otra persona puede acceder a tus registros en este teléfono.',
  accessRestricted:
    'Tu cuenta requiere autorización de tu centro de salud o equipo oncológico tratante.',
  resumeOnboarding: 'Continuar registro de paciente',
} as const;

export const HOME_AND_MEDICATIONS_COPY = {
  greetingDefault: 'Hola',
  nextMedication: 'Próxima toma de medicamento',
  noMedicationsScheduled: 'No tienes medicamentos programados para hoy',
  noTreatmentLinked: 'Tratamiento en proceso de vinculación con tu centro de salud',
  confirmIntake: 'Registrar que tomé este medicamento',
  omitIntake: 'Indicar que no pude tomarlo',
  intakeLogTitle: 'Bitácora de tomas en este teléfono',
  intakeLogSubtitle:
    'Lleva un registro claro de las dosis declaradas en este teléfono para recordar tu horario.',
  urgentHelp: 'Contactar a mi equipo de salud',
  emergencyNotice:
    'Si presentas fiebre sobre 38 °C o dificultad para respirar, acude de inmediato a Urgencias.',
  nurseContact: 'Llamar a enfermera de enlace oncológico',
} as const;

export const VITALS_AND_MEASUREMENTS_COPY = {
  vitalsHubTitle: 'Mis signos vitales',
  temperature: 'Temperatura corporal',
  pulse: 'Frecuencia cardíaca (pulso)',
  bloodPressure: 'Presión arterial',
  systolicPressure: 'Presión sistólica (alta)',
  diastolicPressure: 'Presión diastólica (baja)',
  oxygenSaturation: 'Saturación de oxígeno',
  weight: 'Peso corporal',
  inRange: 'Dentro del rango esperado',
  outOfRange: 'Fuera del rango esperado — Revisa las indicaciones de tu equipo',
  sevenDaysEvolution: 'Evolución de los últimos 7 días',
  noVitalsRecorded: 'Sin mediciones registradas en este período',
  recordVitalButton: 'Registrar nueva medición',
  vitalSavedSuccess: 'Medición de signos vitales guardada en este teléfono.',
} as const;

export const EPRO_FORMS_COPY = {
  formHubTitle: 'Seguimiento de síntomas y bienestar',
  formTitle: '¿Cómo te has sentido hoy?',
  stepByStep: 'Modo paso a paso',
  pauseAndResume: 'Puedes pausar cuando quieras; tu borrador queda guardado en este teléfono.',
  pausedNotice: 'Borrador guardado. Puedes continuar respondiendo cuando descanses.',
  reviewBeforeSubmit: 'Revisa tus respuestas antes de enviar',
  submitConfirmation: 'Tus respuestas han sido registradas y enviadas a tu equipo tratante.',
  newEditionAvailable:
    'Hay una actualización disponible en el cuestionario enviada por tu centro de salud.',
  formNotPublished: 'No hay un cuestionario diario asignado a tu esquema en este momento.',
} as const;

export const REPORTS_AND_VIEWERS_COPY = {
  reportsTitle: 'Mis reportes médicos',
  reportsSubtitle:
    'Genera informes de tus mediciones y síntomas para revisarlos con tu médico tratante.',
  period7Days: 'Últimos 7 días',
  period30Days: 'Últimos 30 días',
  period90Days: 'Últimos 90 días',
  formatPdf: 'Documento PDF oficial',
  formatXlsx: 'Planilla Excel (.xlsx)',
  generateButton: 'Crear reporte médico',
  generatingNotice: 'Preparando tu reporte médico de forma segura en este teléfono…',
  viewReport: 'Ver reporte',
  shareReport: 'Compartir reporte',
  deleteReport: 'Eliminar reporte de este teléfono',
  deleteConfirm: '¿Deseas eliminar este reporte del almacenamiento de este teléfono?',
  viewModeVisual: 'Vista visual',
  viewModeAccessible: 'Lectura accesible por voz',
  pageIndicator: (page: number, total: number) => `Página ${page} de ${total}`,
  legacyReportNotice:
    'Este reporte fue generado con una versión anterior que no incluye lectura accesible estructurada. Puedes revisarlo en la pestaña "Vista visual".',
  emptyPeriodError:
    'No hay mediciones ni síntomas registrados en el período seleccionado para generar un reporte.',
  xlsxSheetVitals: 'Signos Vitales',
  xlsxSheetSummary: 'Resumen Clínico',
  xlsxSheetSymptoms: 'Síntomas',
} as const;

export const MULTIMEDIA_AND_EDUCATION_COPY = {
  educationTitle: 'Biblioteca educativa',
  educationSubtitle: 'Guías prácticas, videos explicativos y podcasts para tu cuidado en el hogar.',
  youtubeTitle: 'Video educativo',
  youtubeFullscreen: 'Pantalla completa',
  youtubeExitFullscreen: 'Salir de pantalla completa',
  youtubeOffline:
    'Los videos educativos requieren conexión a internet. Puedes revisar las guías y podcasts que ya tienes descargados en este teléfono.',
  // Etiquetas del botón principal: describen la acción que ocurre al tocarlo, como el mini reproductor.
  audioPause: 'Pausar podcast',
  audioResume: 'Reanudar reproducción',
  audioSpeed: 'Velocidad de reproducción',
  audioRewind15: 'Retroceder 15 segundos',
  audioForward15: 'Adelantar 15 segundos',
  audioCloseMiniPlayer: 'Cerrar reproductor de audio',
  audioExpandPlayer: 'Abrir reproductor completo',
  audioCoordinatedWithVideo:
    'El podcast se pausó automáticamente para que disfrutes este video educativo sin interferencias.',
  downloadedSectionTitle: 'Descargados en este teléfono',
  availableCatalogTitle: 'Catálogo disponible en línea',
  downloadGuide: 'Descargar guía',
  downloadInProgress: 'Descargando guía en este teléfono…',
  downloadError:
    'No se pudo descargar la guía en este momento. Revisa tu conexión a internet e intenta nuevamente.',
  podcastTitle: 'Podcast CUIDAQUIMIO',
} as const;

/**
 * Lista de términos técnicos de ingeniería prohibidos en textos de cara al paciente.
 */
export const PROHIBITED_TECHNICAL_TERMS = [
  'OAuth',
  'PowerSync',
  'SQLite',
  'SheetJS',
  'FileCipher',
  'lease',
  'HTTP 403',
  'upstream',
  'downstream',
] as const;

/**
 * Validador que comprueba recursivamente que ningún texto expuesto contenga términos prohibidos.
 */
export function containsProhibitedTerm(text: string): string | null {
  for (const term of PROHIBITED_TECHNICAL_TERMS) {
    const regex = new RegExp(`\\b${term}\\b`, 'i');
    if (regex.test(text)) {
      return term;
    }
  }
  return null;
}

/**
 * Resuelve el texto de estado de sincronización y entrega comprensible para el paciente.
 */
export function getPatientSyncStatusText(
  status: 'saved_locally' | 'pending_upload' | 'synced_server',
): string {
  switch (status) {
    case 'saved_locally':
      return SYNC_AND_STORAGE_COPY.savedLocally;
    case 'pending_upload':
      return SYNC_AND_STORAGE_COPY.pendingUpload;
    case 'synced_server':
      return SYNC_AND_STORAGE_COPY.syncedWithServer;
  }
}

/**
 * Resuelve el texto del período de reportes en lenguaje amigable.
 */
export function getReportPeriodText(days: 7 | 30 | 90): string {
  switch (days) {
    case 7:
      return REPORTS_AND_VIEWERS_COPY.period7Days;
    case 30:
      return REPORTS_AND_VIEWERS_COPY.period30Days;
    case 90:
      return REPORTS_AND_VIEWERS_COPY.period90Days;
  }
}
