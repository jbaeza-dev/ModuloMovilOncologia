export type Answer = 'yes' | 'no' | 'unknown';
export type Orientation = 'A1' | 'A2' | 'B' | 'C' | 'D';
export type Informant = 'PACIENTE' | 'CUIDADOR_FAMILIAR';
export type TemperatureSite = 'axillary' | 'oral' | 'tympanic' | 'other' | 'unknown';

/** Questions are a separate, provisional instrument, never an edit of the 41-item ePRO. */
export const questions = [
  {
    id: 'A1-RESP',
    group: 'A1',
    text: '¿Hay dificultad respiratoria importante en reposo, cierre de garganta o dificultad marcada para hablar por falta de aire?',
  },
  {
    id: 'A1-TORAX',
    group: 'A1',
    text: '¿Hay dolor o presión nuevos/importantes en el pecho, especialmente con falta de aire, desvanecimiento o sangre al toser?',
  },
  {
    id: 'A1-CONCIENCIA',
    group: 'A1',
    text: '¿La persona no responde, cuesta despertarla, tiene confusión nueva importante, desmayo o convulsión actual?',
  },
  {
    id: 'A1-SANGRADO',
    group: 'A1',
    text: '¿Hay sangrado abundante que no se detiene, o sangrado con desmayo o deterioro importante?',
  },
  {
    id: 'A1-NEURO',
    group: 'A1',
    text: '¿Hay pérdida repentina de fuerza de un lado, alteración súbita del habla o pérdida súbita de función neurológica?',
  },
  {
    id: 'A2-INFECCION',
    group: 'A2',
    text: '¿Hay escalofríos o tiritones nuevos, o un deterioro general nuevo o sensación de enfermedad importante, aunque la temperatura sea normal o no se haya medido?',
  },
  {
    id: 'A2-INGESTA',
    group: 'A2',
    text: '¿No puedes retener líquidos o medicación necesaria, o hay vómitos/diarrea no controlados o signos relevantes de deshidratación?',
  },
  {
    id: 'A2-DIGESTIVO',
    group: 'A2',
    text: '¿Hay sangre en vómito o deposiciones, deposiciones negras tipo alquitrán, o dolor abdominal fuerte con distensión, vómitos o falta de eliminación de gases?',
  },
  {
    id: 'A2-MEDULA',
    group: 'A2',
    text: '¿Hay debilidad nueva o progresiva, dificultad nueva para caminar o cambios nuevos del control de orina o deposiciones, especialmente con dolor de espalda?',
  },
  {
    id: 'A2-TROMBO',
    group: 'A2',
    text: '¿Hay hinchazón nueva de un solo brazo o pierna con dolor o calor, o un problema importante del lado del catéter?',
  },
  {
    id: 'A2-LOCAL',
    group: 'A2',
    text: '¿El catéter está rojo, caliente, hinchado, con secreción o dolor importante en la zona de infusión, especialmente con malestar o fiebre?',
  },
  {
    id: 'B-SYMPTOMS',
    group: 'B',
    text: '¿Hay síntomas nuevos, moderados, en aumento, persistentes o mal controlados con tus indicaciones habituales, o algo que te preocupa y no está resuelto?',
  },
  {
    id: 'B-PAIN-CONTEXT',
    group: 'B',
    text: '¿El dolor es nuevo, aumenta, afecta el sueño o tus actividades, o no responde a la pauta indicada?',
  },
  {
    id: 'C-KNOWN',
    group: 'C',
    text: '¿Las molestias son ausentes o leves, conocidas o previstas y no han empeorado?',
  },
  {
    id: 'C-INTAKE',
    group: 'C',
    text: '¿Puedes beber, alimentarte según lo indicado y tomar tu medicación, sin pérdidas relevantes de líquidos ni pérdida funcional nueva?',
  },
  {
    id: 'C-CONTROL',
    group: 'C',
    text: '¿El dolor está controlado y no ocurre en un contexto de alarma?',
  },
  {
    id: 'C-PLAN',
    group: 'C',
    text: '¿Tienes indicaciones previas de tu equipo para estas molestias y sabes cuándo pedir ayuda?',
  },
  {
    id: 'C-INTERPRETED',
    group: 'C',
    text: '¿No queda ningún síntoma o medición relevante sin interpretar o señalado como anormal?',
  },
] as const;
export type QuestionId = (typeof questions)[number]['id'];
export interface TemperaturePolicy {
  site: TemperatureSite;
  high: number;
  highInclusive: boolean;
  low: number;
  lowInclusive: boolean;
}
export interface Approval {
  reviewer: string;
  reviewedAt: string;
  actReference: string;
  resolutions: string[];
}
export interface OrientationDefinition {
  id: string;
  version: string;
  status: 'draft' | 'approved';
  sourceHash: string;
  approval: Approval | null;
  temperaturePolicies: readonly TemperaturePolicy[];
  messages: Readonly<Record<Orientation | 'individualPlan', string>>;
}
export const proposal: OrientationDefinition = {
  id: 'quimiocare-orientacion-oncologica',
  version: '1.0.0',
  status: 'draft',
  sourceHash: '8e023072eab17284dec2a0c7dd9ed7f6d00ca3ceb0e9c733f8e66256f29c8f0b',
  approval: null,
  temperaturePolicies: [],
  messages: {
    A1: 'Lo que describes necesita ayuda inmediata. Llama al SAMU 131 o pide a alguien que lo haga por ti. No esperes otra medición, terminar el formulario ni una respuesta de la aplicación. Si tienes un plan de cuidados paliativos, comunícalo al profesional que te atienda.',
    A2: 'Estas señales pueden corresponder a una complicación de tu enfermedad o tratamiento. Necesitas valoración profesional ahora. Sigue el circuito urgente que te indicó tu equipo. Si no puedes acceder de inmediato a esa valoración, acude a urgencias e informa que estás en quimioterapia. Si aparecen dificultad respiratoria importante, desmayo o sangrado abundante, busca ayuda de emergencia.',
    B: 'Tus molestias necesitan indicaciones de tu equipo tratante. Contacta por el canal que te entregó y revisa su horario. Si está cerrado o no responden, puedes pedir orientación a Salud Responde, 600 360 7777, disponible las 24 horas. No esperes al siguiente día hábil si el malestar aumenta o no se controla con tu pauta: busca valoración urgente. Si aparece una señal de emergencia, llama al 131. La app no ha avisado a un profesional.',
    C: 'Con lo que has informado en esta evaluación no se identificaron señales de alarma de las que revisa la app. Continúa las indicaciones que ya te entregó tu equipo y el seguimiento acordado. Este resultado corresponde a este momento: si aparece fiebre, falta de aire, sangrado, dolor nuevo/importante o empeoramiento, vuelve a pedir orientación y busca ayuda según las señales. Puedes contactar a tu equipo aunque la app no muestre una alarma.',
    D: 'No pudimos completar la orientación con estos datos. Si te sientes mal, tienes dudas o no puedes aclararlos, pide orientación ahora a tu equipo o a Salud Responde, 600 360 7777. Si tienes una señal de emergencia, llama al 131. La app no ha avisado a un profesional.',
    individualPlan:
      'Necesitas ayuda ahora. Sigue el plan que tu equipo dejó para esta situación y contacta al número y alternativa indicados en él. Comunica tus preferencias de atención. Si no puedes seguirlo o no obtienes la ayuda prevista, busca ayuda urgente e informa que tienes un plan paliativo.',
  },
};
