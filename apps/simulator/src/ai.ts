import type { ScenarioState } from './types.js';

/** Deterministic single-message stub. It never stores the message or manufactures clinical advice. */
export function aiResponse(state: ScenarioState, message: string) {
  const unavailable = state.escenario === 'IA_NO_DISPONIBLE';
  const urgent = state.escenario === 'IA_URGENCIA';
  const courtesy = /^(hola|gracias|adiós|adios)[.!\s]*$/iu.test(message.trim());
  const noInformation = message.trim() === 'DEMO_SIN_INFORMACION';
  return {
    respuesta: unavailable
      ? 'Respuesta sintética: servicio de generación no disponible.'
      : urgent
        ? 'Respuesta sintética de prueba de urgencia; no se ha avisado a un profesional.'
        : courtesy
          ? 'Saludo sintético del simulador QuimioCare.'
          : 'Respuesta sintética del contrato: consulte los contenidos validados de su equipo de salud.',
    fuentes: [],
    requiere_urgencia: urgent,
    confianza_nivel: unavailable || urgent || courtesy ? 'ninguna' : 'baja',
    estado_respuesta:
      unavailable || urgent
        ? 'no_disponible'
        : courtesy
          ? 'cortesia'
          : noInformation
            ? 'sin_informacion'
            : 'respuesta',
    debug: null,
  };
}
