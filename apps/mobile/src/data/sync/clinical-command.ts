import { VITAL_DOMAINS } from '../local/validation';
import type { SqlConnection } from '../local/core/sql';
import { agendaDate } from '@quimiocare/contracts/agenda';
import { enqueueOperational } from '../agenda/operational-outbox';
import { isUuid, object } from '../../services/session/response-checks';

export type ClinicalKind = 'signos' | 'epro';
export interface ClinicalScope {
  owner: string;
  localPatientId: string;
  environment: string;
}
export interface ClinicalCommand {
  id: string;
  owner: string;
  environment: string;
  kind: ClinicalKind;
  captured_at: string;
  payload_json: string;
  legacy_queue_id: string | null;
  status: 'pendiente' | 'pausado' | 'aceptado' | 'rechazado';
  ack_json: string | null;
  error_json: string | null;
  attempts: number;
}
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value))
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    );
  throw new Error('El snapshot clínico no es JSON válido.');
}
export function payloadOf(
  command: Pick<ClinicalCommand, 'id' | 'kind' | 'captured_at' | 'payload_json'>,
): Record<string, unknown> {
  const body: unknown = JSON.parse(command.payload_json);
  if (
    !object(body) ||
    !isUuid(command.id) ||
    body.id !== command.id ||
    !Number.isFinite(Date.parse(command.captured_at))
  )
    throw new Error('Snapshot clínico incoherente.');
  const allowed =
    command.kind === 'signos'
      ? [
          'id',
          'fecha_registro',
          'presion_arterial_sistolica',
          'presion_arterial_diastolica',
          'pulso',
          'temperatura',
          'saturacion_oxigeno',
          'dolor_ena',
          'version_dolor',
        ]
      : [
          'id',
          'formulario_id',
          'formulario_version',
          'fecha_respuesta',
          'respuestas',
          'comentario',
          'question_codes',
        ];
  if (Object.keys(body).some((k) => !allowed.includes(k)))
    throw new Error('El comando contiene campos no contractuales.');
  const date = command.kind === 'signos' ? body.fecha_registro : body.fecha_respuesta;
  if (date !== command.captured_at) throw new Error('Se modificó la fecha original.');
  if (command.kind === 'signos') {
    if (Object.hasOwn(body, 'dolor_ena') || Object.hasOwn(body, 'version_dolor')) {
      if (
        body.version_dolor !== 1 ||
        !Number.isInteger(body.dolor_ena) ||
        Number(body.dolor_ena) < 0 ||
        Number(body.dolor_ena) > 10
      )
        throw new Error('Escala ENA no contractual.');
    }
    const domains = {
      temperatura: VITAL_DOMAINS.temperature,
      presion_arterial_sistolica: VITAL_DOMAINS.systolic,
      presion_arterial_diastolica: VITAL_DOMAINS.diastolic,
      pulso: VITAL_DOMAINS.pulse,
      saturacion_oxigeno: VITAL_DOMAINS.saturation,
      dolor_ena: VITAL_DOMAINS.pain,
    };
    for (const [key, domain] of Object.entries(domains)) {
      const value = body[key];
      if (value == null) continue;
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < domain.min ||
        value > domain.max ||
        (domain.integer && !Number.isInteger(value))
      )
        throw new Error('Medición fuera del dominio contractual.');
    }
    if (
      body.version_dolor === 1 &&
      typeof body.temperatura === 'number' &&
      Math.abs(body.temperatura * 10 - Math.round(body.temperatura * 10)) > 1e-7
    )
      throw new Error('La captura nueva de temperatura exige precisión explícita.');
    if (
      typeof body.presion_arterial_sistolica === 'number' &&
      typeof body.presion_arterial_diastolica === 'number' &&
      body.presion_arterial_sistolica <= body.presion_arterial_diastolica
    )
      throw new Error('La presión sistólica debe superar la diastólica.');
    const measurements = allowed.slice(2).filter((key) => key !== 'version_dolor');
    if (
      !measurements.some((k) => typeof body[k] === 'number') ||
      measurements.some(
        (k) =>
          body[k] !== undefined &&
          body[k] !== null &&
          (typeof body[k] !== 'number' || !Number.isFinite(body[k])),
      )
    )
      throw new Error('Mediciones no contractuales.');
  } else {
    if (
      !isUuid(body.formulario_id) ||
      !Number.isInteger(body.formulario_version) ||
      Number(body.formulario_version) < 1 ||
      !Array.isArray(body.respuestas) ||
      body.respuestas.length === 0 ||
      !object(body.question_codes)
    )
      throw new Error('Edición o respuestas no contractuales.');
    const codes = new Set<string>();
    for (const item of body.respuestas) {
      if (
        !object(item) ||
        !isUuid(item.pregunta_id) ||
        typeof body.question_codes[item.pregunta_id] !== 'string' ||
        !body.question_codes[item.pregunta_id] ||
        !Object.hasOwn(item, 'valor') ||
        codes.has(item.pregunta_id) ||
        Object.keys(item).some((k) => !['pregunta_id', 'valor', 'valor_texto'].includes(k))
      )
        throw new Error('Respuesta de pregunta incoherente.');
      codes.add(item.pregunta_id);
    }
  }
  canonical(body);
  return body;
}

/** Caller must use the same SDK write transaction as history and operational data. */
export async function enqueueClinicalCommand(
  tx: SqlConnection,
  scope: ClinicalScope,
  input: {
    kind: ClinicalKind;
    payload: Record<string, unknown>;
    capturedAt: string;
    legacyQueueId?: string | null;
    registeredAt?: string | null;
  },
  now = new Date().toISOString(),
) {
  if (!isUuid(scope.owner) || !scope.environment)
    throw new Error('Falta el contexto de la captura.');
  const command = {
    id: String(input.payload.id),
    owner: scope.owner,
    environment: scope.environment,
    kind: input.kind,
    captured_at: input.capturedAt,
    payload_json: canonical(input.payload),
    legacy_queue_id: input.legacyQueueId ?? null,
  };
  payloadOf(command);
  const old = await tx.first<ClinicalCommand>('SELECT * FROM qc_clinical_command WHERE id = ?', [
    command.id,
  ]);
  if (old) {
    if (
      old.owner !== command.owner ||
      old.environment !== command.environment ||
      old.kind !== command.kind ||
      old.captured_at !== command.captured_at ||
      old.payload_json !== command.payload_json ||
      old.legacy_queue_id !== command.legacy_queue_id
    )
      throw new Error('El UUID ya identifica otro snapshot.');
    return false;
  }
  await tx.run(
    `INSERT INTO qc_clinical_command(id, owner, environment, kind, captured_at, payload_json, legacy_queue_id, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)`,
    [
      command.id,
      command.owner,
      command.environment,
      command.kind,
      command.captured_at,
      command.payload_json,
      command.legacy_queue_id,
      now,
    ],
  );
  const table = input.kind === 'signos' ? 'qc_upload_signos' : 'qc_upload_epro';
  await tx.run(
    `INSERT INTO ${table}(id, owner, environment, captured_at, payload_json, legacy_queue_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      command.id,
      command.owner,
      command.environment,
      command.captured_at,
      command.payload_json,
      command.legacy_queue_id,
    ],
  );
  await tx.run(
    `INSERT INTO qc_operational_event(id, owner, record_id, kind, captured_at, registered_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      'clinical:' + command.id,
      scope.owner,
      command.id,
      input.kind,
      command.captured_at,
      input.registeredAt === undefined ? now : input.registeredAt,
    ],
  );
  const registeredAt = input.registeredAt === undefined ? now : input.registeredAt;
  if (registeredAt !== null)
    await enqueueOperational(
      tx,
      scope,
      'completion',
      {
        operacion_id: command.id,
        tipo_registro: input.kind,
        fecha_local: agendaDate(registeredAt),
        zona_horaria: 'America/Santiago',
        registrado_en: registeredAt,
      },
      registeredAt,
    );
  return true;
}
