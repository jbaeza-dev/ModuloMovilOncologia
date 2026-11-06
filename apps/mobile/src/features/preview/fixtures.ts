export const vitalRecords = [
  {
    id: 'a',
    date: '12 sep · 09:40',
    temperature: '36,8 °C',
    pressure: '118/76 mmHg',
    pulse: '72 lpm',
    saturation: '98 %',
    pain: '2/10',
    period: 7,
  },
  {
    id: 'b',
    date: '10 sep · 09:20',
    temperature: '36,9 °C',
    pressure: '120/78 mmHg',
    pulse: '74 lpm',
    saturation: '97 %',
    pain: '0/10',
    period: 7,
  },
  {
    id: 'c',
    date: '23 ago · 10:15',
    temperature: '37,0 °C',
    pressure: '116/75 mmHg',
    pulse: '70 lpm',
    saturation: '98 %',
    period: 30,
  },
  {
    id: 'd',
    date: '18 jul · 08:30',
    temperature: '36,7 °C',
    pressure: '119/77 mmHg',
    pulse: '71 lpm',
    saturation: '99 %',
    period: 90,
  },
] as const;

export const educationCategories = [
  { title: 'Conocer la quimioterapia', count: '3 recursos', icon: 'book-open' },
  { title: 'Cuidados cotidianos', count: '4 recursos', icon: 'heart' },
  { title: 'Alimentación y bienestar', count: '2 recursos', icon: 'coffee' },
] as const;

export type EducationResource = {
  id: string;
  category: number;
  title: string;
  type: string;
  duration: string;
  state: string;
  content: string;
};

export const educationResources: readonly EducationResource[] = [
  {
    id: 'edu-prep-sesion',
    category: 0,
    title: 'Prepararse para una sesión',
    type: 'Guía',
    duration: 'Lectura de 3 min',
    state: 'Disponible para guardar',
    content: `# Prepararse para una sesión\n\nEste texto es material de muestra neutro para la demostración técnica del guardado y lectura de archivos sin conexión en el dispositivo móvil.\n\nNo contiene indicaciones médicas, umbrales clínicos ni recomendaciones de tratamiento, los cuales serán incorporados tras la correspondiente validación clínica del equipo de salud.`,
  },
  {
    id: 'edu-cuidados-casa',
    category: 0,
    title: 'Cuidados en casa',
    type: 'Guía',
    duration: 'Lectura de 4 min',
    state: 'Disponible para guardar',
    content: `# Cuidados en el hogar\n\nMaterial de demostración técnica para validar la persistencia local de recursos educativos.\n\nEste contenido es un texto de prueba neutro para comprobar el almacenamiento físico del archivo en el teléfono y su posterior visualización sin red.`,
  },
  {
    id: 'edu-preguntas-frecuentes',
    category: 0,
    title: 'Preguntas frecuentes',
    type: 'Guía',
    duration: 'Lectura de 5 min',
    state: 'Disponible para guardar',
    content: `# Preguntas frecuentes sobre el acompañamiento\n\nTexto de muestra utilizado exclusivamente para validar el aislamiento de archivos por paciente y la lectura local sin conexión en QuimioCare.`,
  },
  {
    id: 'edu-organizar-preguntas',
    category: 1,
    title: 'Organizar tus preguntas',
    type: 'Guía',
    duration: 'Lectura de 3 min',
    state: 'Disponible para guardar',
    content: `# Organizar tus consultas\n\nDocumento de prueba técnica para verificar que el almacenamiento de copias locales funciona de manera aislada por paciente en el dispositivo.`,
  },
  {
    id: 'edu-rutina-cotidiana',
    category: 1,
    title: 'Rutina cotidiana',
    type: 'Guía',
    duration: 'Lectura de 3 min',
    state: 'Disponible para guardar',
    content: `# Rutina diaria de ejemplo\n\nMaterial de prueba sin recomendaciones clínicas para la verificación de almacenamiento y borrado físico de archivos.`,
  },
  {
    id: 'edu-descanso-acompanamiento',
    category: 1,
    title: 'Descanso y acompañamiento',
    type: 'Guía',
    duration: 'Lectura de 4 min',
    state: 'Disponible para guardar',
    content: `# Descanso y bienestar\n\nTexto demostrativo para la evaluación técnica del módulo móvil.`,
  },
  {
    id: 'edu-apoyo-familiar',
    category: 1,
    title: 'Apoyo familiar',
    type: 'Guía',
    duration: 'Lectura de 3 min',
    state: 'Disponible para guardar',
    content: `# Red de apoyo y acompañamiento\n\nDocumento neutral para pruebas de lectura fuera de línea.`,
  },
  {
    id: 'edu-alimentacion-diaria',
    category: 2,
    title: 'Alimentación diaria',
    type: 'Guía',
    duration: 'Lectura de 4 min',
    state: 'Disponible para guardar',
    content: `# Información sobre alimentación\n\nTexto de prueba técnica. El contenido clínico definitivo será suministrado por el equipo tratante en futuras etapas del proyecto.`,
  },
  {
    id: 'edu-bienestar-general',
    category: 2,
    title: 'Bienestar general',
    type: 'Guía',
    duration: 'Lectura de 4 min',
    state: 'Disponible para guardar',
    content: `# Bienestar y seguimiento\n\nMaterial de demostración técnica para la persistencia SQLite en QuimioCare.`,
  },
] as const;
