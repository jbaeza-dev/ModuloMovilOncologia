import type { SqlConnection } from '../local/core/sql';
import { object, isUuid } from '../../services/session/response-checks';
import {
  enqueueClinicalCommand,
  canonical,
  payloadOf,
  type ClinicalScope,
} from './clinical-command';

export type ClinicalCaptureHook = (tx: SqlConnection, queueId: string) => Promise<void>;
interface LegacyQueue {
  id: string;
  paciente_id: string;
  registro_id: string;
  tipo_entidad: string;
  payload_json: string;
  estado: string;
}

export async function transferLegacyCommand(
  tx: SqlConnection,
  scope: ClinicalScope,
  queueId: string,
  strict = false,
): Promise<'transferred' | 'preserved'> {
  const queue = await tx.first<LegacyQueue>('SELECT * FROM cola_envio WHERE id = ?', [queueId]);
  if (!queue || queue.paciente_id !== scope.localPatientId)
    throw new Error('La cola no pertenece al contexto.');
  const preserve = async (code: string) => {
    if (strict && code === 'SNAPSHOT_LEGADO_INCOHERENTE')
      throw new Error('La captura y su snapshot no coinciden.');
    await tx.run(
      'INSERT INTO qc_storage_control(id, value_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value_json = excluded.value_json',
      ['legacy:' + queue.id, canonical({ code, queueId: queue.id, state: 'guardado_local' })],
    );
    return 'preserved' as const;
  };
  if (queue.estado === 'enviado') return preserve('HISTORICO_YA_ENVIADO');
  // Free text history and old local consent acts are never reinterpreted as ePRO.
  if (!['signos_vitales', 'respuesta_formulario'].includes(queue.tipo_entidad))
    return preserve('LEGADO_NO_ES_COMANDO_CLINICO_V1');
  if (!isUuid(queue.registro_id)) return preserve('IDENTIFICADOR_LEGADO_NO_CONTRACTUAL');
  let envelope: unknown;
  try {
    envelope = JSON.parse(queue.payload_json);
  } catch {
    return preserve('SNAPSHOT_LEGADO_INCOHERENTE');
  }
  if (
    !object(envelope) ||
    !object(envelope.record) ||
    envelope.record.id !== queue.registro_id ||
    envelope.record.paciente_id !== scope.localPatientId
  )
    return preserve('SNAPSHOT_LEGADO_INCOHERENTE');
  const record = envelope.record;
  if (queue.tipo_entidad === 'signos_vitales') {
    const history = await tx.first<Record<string, unknown>>(
      'SELECT * FROM signos_vitales WHERE id = ? AND paciente_id = ?',
      [queue.registro_id, scope.localPatientId],
    );
    if (
      !history ||
      [
        'fecha_registro',
        'temperatura',
        'presion_sistolica',
        'presion_diastolica',
        'pulso',
        'saturacion_o2',
        'dolor_ena',
      ].some((k) => (history[k] ?? null) !== (record[k] ?? null))
    )
      return preserve('SNAPSHOT_LEGADO_INCOHERENTE');
    const payload = {
      ...(record.dolor_ena != null ? { version_dolor: 1, dolor_ena: record.dolor_ena } : {}),
      id: record.id,
      fecha_registro: record.fecha_registro,
      temperatura: record.temperatura ?? null,
      presion_arterial_sistolica: record.presion_sistolica ?? null,
      presion_arterial_diastolica: record.presion_diastolica ?? null,
      pulso: record.pulso ?? null,
      saturacion_oxigeno: record.saturacion_o2 ?? null,
    };
    try {
      payloadOf({
        id: String(record.id),
        kind: 'signos',
        captured_at: String(record.fecha_registro),
        payload_json: canonical(payload),
      });
    } catch {
      if (strict) throw new Error('La captura nueva contiene mediciones inválidas.');
      return preserve('MEDICIONES_LEGADAS_FUERA_CONTRATO');
    }
    await enqueueClinicalCommand(tx, scope, {
      kind: 'signos',
      payload,
      capturedAt: String(record.fecha_registro),
      legacyQueueId: queue.id,
      registeredAt: strict ? String(history.creado_localmente_en) : null,
    });
    return 'transferred';
  }
  if (
    !isUuid(record.formulario_id) ||
    typeof record.version !== 'string' ||
    !/^[1-9]\d*$/.test(record.version) ||
    !object(record.respuestas)
  )
    return preserve('EDICION_LEGADA_SIN_MAPEO_CONTRACTUAL');
  const questions = await tx.all<{ id: string; codigo: string }>(
    'SELECT id, codigo FROM pregunta WHERE formulario_id = ?',
    [record.formulario_id],
  );
  const answers = record.respuestas;
  const codes: Record<string, string> = {};
  const items: { pregunta_id: string; valor: unknown }[] = [];
  for (const [id, value] of Object.entries(answers)) {
    const question = questions.find((q) => q.id === id);
    if (!question) return preserve('DEFINICION_SIN_REPLICA');
    codes[id] = question.codigo;
    items.push({ pregunta_id: id, valor: value });
  }
  const history = await tx.first<Record<string, unknown>>(
    'SELECT * FROM respuesta_formulario WHERE id = ? AND paciente_id = ?',
    [queue.registro_id, scope.localPatientId],
  );
  if (
    !history ||
    history.formulario_id !== record.formulario_id ||
    history.version !== record.version ||
    history.fecha_confirmacion !== record.fecha_confirmacion ||
    canonical(JSON.parse(String(history.respuestas_json))) !== canonical(answers)
  )
    return preserve('SNAPSHOT_LEGADO_INCOHERENTE');
  await enqueueClinicalCommand(tx, scope, {
    kind: 'epro',
    capturedAt: String(record.fecha_confirmacion),
    legacyQueueId: queue.id,
    registeredAt: strict ? String(history.creado_localmente_en) : null,
    payload: {
      id: record.id,
      formulario_id: record.formulario_id,
      formulario_version: Number(record.version),
      fecha_respuesta: record.fecha_confirmacion,
      respuestas: items,
      question_codes: codes,
    },
  });
  return 'transferred';
}

export function clinicalCaptureHook(scope: ClinicalScope): ClinicalCaptureHook {
  return async (tx, queueId) => {
    await transferLegacyCommand(tx, scope, queueId, true);
  };
}
