import { object, isUuid } from '../../services/session/response-checks';
import { canonical, payloadOf, type ClinicalCommand } from './clinical-command';

const instant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function coherentAck(command: ClinicalCommand, status: number, ack: unknown): boolean {
  const body = payloadOf(command);
  if (!object(ack) || ack.id !== command.id) return false;
  if (command.kind === 'signos') {
    if (
      ![200, 201].includes(status) ||
      ack.sincronizado !== true ||
      !instant(ack.fecha_subida) ||
      !instant(ack.fecha_registro) ||
      Math.abs(Date.parse(String(ack.fecha_registro)) - Date.parse(command.captured_at)) > 1000
    )
      return false;
    for (const key of [
      'presion_arterial_sistolica',
      'presion_arterial_diastolica',
      'pulso',
      'temperatura',
      'saturacion_oxigeno',
      'version_dolor',
      'dolor_ena',
    ]) {
      const expected = body[key] ?? null,
        actual = ack[key] ?? null;
      if (key === 'temperatura' && typeof expected === 'number' && typeof actual === 'number') {
        if (
          Math.abs(actual * 10 - Math.round(actual * 10)) > 1e-7 ||
          Math.abs(actual - expected) > 0.05000001
        )
          return false;
      } else if (actual !== expected) return false;
    }
    return true;
  }
  if (
    status !== 201 ||
    !isUuid(ack.paciente_id) ||
    ack.paciente_id !== command.owner ||
    ack.formulario_id !== body.formulario_id ||
    ack.formulario_version !== body.formulario_version ||
    !instant(ack.fecha_respuesta_cliente) ||
    !instant(ack.fecha_recepcion_servidor) ||
    !Array.isArray(ack.respuestas)
  )
    return false;
  if (String(ack.comentario ?? '').trim() !== String(body.comentario ?? '').trim()) return false;
  const expected = body.respuestas as Record<string, unknown>[];
  if (ack.respuestas.length !== expected.length) return false;
  const seen = new Set<string>();
  for (const item of ack.respuestas) {
    if (!object(item) || typeof item.codigo_pregunta !== 'string' || seen.has(item.codigo_pregunta))
      return false;
    seen.add(item.codigo_pregunta);
    const match = expected.find((r) => r.pregunta_id === item.pregunta_id);
    if (
      !match ||
      (body.question_codes as Record<string, unknown>)[String(item.pregunta_id)] !==
        item.codigo_pregunta ||
      canonical(match.valor) !== canonical(item.valor)
    )
      return false;
  }
  return true;
}

export type ErrorDecision = 'retry' | 'pause' | 'reject';
export function classifyClinicalError(
  status: number,
  body: unknown,
): { decision: ErrorDecision; code: string } {
  if (status >= 500 || status === 408 || status === 429)
    return { decision: 'retry', code: 'DEPENDENCIA_TRANSITORIA' };
  if (
    !object(body) ||
    !object(body.error) ||
    typeof body.error.codigo !== 'string' ||
    body.error.status_code !== status
  )
    return { decision: 'pause', code: 'ERROR_NO_CLASIFICADO' };
  const code = body.error.codigo;
  if (status === 409 && code === 'CONFLICTO_ESTADO') return { decision: 'reject', code };
  if (status === 422 && ['ERROR_VALIDACION', 'PREGUNTA_NO_APLICABLE'].includes(code))
    return { decision: 'reject', code };
  if (
    status === 422 &&
    code === 'REGLA_DE_NEGOCIO_INVALIDA' &&
    object(body.error.detalles) &&
    [
      'PREGUNTA_REQUERIDA_FALTANTE',
      'PREGUNTA_REQUERIDA_VACIA',
      'OPCIONES_EXCLUSIVAS_INCOMPATIBLES',
    ].includes(String(body.error.detalles.motivo))
  )
    return { decision: 'reject', code };
  return { decision: 'pause', code };
}
