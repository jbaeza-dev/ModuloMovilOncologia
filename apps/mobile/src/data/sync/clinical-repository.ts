import { validateFormAnswers } from '@quimiocare/contracts/forms';
import { contractForm } from './contract-form';
import { validateCaptureTimestamp } from '../local/validation';
import type { ClinicalResponderFormularioRequestSchema } from '@quimiocare/contracts';
import type { SqlConnection } from '../local/core/sql';
import {
  canonical,
  enqueueClinicalCommand,
  payloadOf,
  type ClinicalScope,
} from './clinical-command';
import type { DefinitionSnapshot } from './catalog';

export async function saveContractEproInTransaction(
  connection: SqlConnection,
  scope: ClinicalScope,
  definition: DefinitionSnapshot,
  request: ClinicalResponderFormularioRequestSchema,
) {
  const edition = contractForm(definition);
  validateFormAnswers(edition, request.respuestas);
  validateCaptureTimestamp(request.fecha_respuesta);
  const formId = String(definition.form.id),
    version = Number(definition.form.version);
  const codes: Record<string, string> = {},
    answers: Record<string, unknown> = {};
  for (const item of request.respuestas) {
    const question = definition.questions.find((q) => q.id === item.pregunta_id);
    if (!question) throw new Error('La respuesta no pertenece a la edición capturada.');
    codes[item.pregunta_id] = String(question.codigo);
    answers[item.pregunta_id] = item.valor;
  }
  const payload = {
    ...request,
    formulario_id: formId,
    formulario_version: version,
    question_codes: codes,
  };
  payloadOf({
    id: request.id,
    kind: 'epro',
    captured_at: request.fecha_respuesta,
    payload_json: canonical(payload),
  });
  const tx = connection;
  {
    await tx.run(
      'INSERT OR IGNORE INTO formulario_cache(formulario_id,version,titulo,descripcion,configuracion_json,obtenido_en) VALUES (?,?,?,?,?,?)',
      [
        formId,
        String(version),
        String(definition.form.titulo),
        String(definition.form.descripcion ?? ''),
        canonical(definition.form.configuracion),
        new Date().toISOString(),
      ],
    );
    const existing = await tx.first<{
      paciente_id: string;
      formulario_id: string;
      version: string;
      respuestas_json: string;
      fecha_confirmacion: string;
    }>('SELECT * FROM respuesta_formulario WHERE id=?', [request.id]);
    if (
      existing &&
      (existing.paciente_id !== scope.localPatientId ||
        existing.formulario_id !== formId ||
        existing.version !== String(version) ||
        existing.fecha_confirmacion !== request.fecha_respuesta ||
        canonical(JSON.parse(existing.respuestas_json)) !== canonical(answers))
    )
      throw new Error('El UUID ya identifica una captura diferente.');
    await tx.run(
      'INSERT OR IGNORE INTO respuesta_formulario(id,paciente_id,formulario_id,version,respuestas_json,fecha_confirmacion,creado_localmente_en) VALUES (?,?,?,?,?,?,?)',
      [
        request.id,
        scope.localPatientId,
        formId,
        String(version),
        canonical(answers),
        request.fecha_respuesta,
        request.fecha_respuesta,
      ],
    );
    await enqueueClinicalCommand(tx, scope, {
      kind: 'epro',
      payload,
      capturedAt: request.fecha_respuesta,
    });
  }
  return request.id;
}

export async function saveContractEpro(
  connection: SqlConnection,
  scope: ClinicalScope,
  definition: DefinitionSnapshot,
  request: ClinicalResponderFormularioRequestSchema,
) {
  await connection.transaction((tx) =>
    saveContractEproInTransaction(tx, scope, definition, request).then(() => undefined),
  );
  return request.id;
}
