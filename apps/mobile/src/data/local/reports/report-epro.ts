import type { FormQuestion } from '@quimiocare/contracts/forms';
import { object } from '../../../services/session/response-checks';
import { contractForm } from '../../sync/contract-form';
import type { DefinitionSnapshot } from '../../sync/catalog';
import type { ReportEproCapture } from './report-types';
import { canonical } from '../../sync/clinical-command';

export interface ReportEproRow {
  id: string;
  formulario_id: string;
  version: string;
  respuestas_json: string;
  fecha_confirmacion: string;
  titulo: string | null;
  snapshot_json: string | null;
  status: string | null;
  owner: string | null;
  environment: string | null;
}
function label(q: FormQuestion | undefined, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Sin respuesta';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  const option = (v: unknown) =>
    q?.opciones?.find((o) => o.codigo === String(v))?.etiqueta ?? String(v);
  return Array.isArray(value) ? value.map(option).join('; ') : option(value);
}
export function reportEpro(
  row: ReportEproRow,
  fallbackQuestions?: readonly FormQuestion[],
): ReportEproCapture {
  const answers: unknown = JSON.parse(row.respuestas_json);
  if (!object(answers)) throw new Error('Respuesta histórica inválida para el reporte.');
  let questions: FormQuestion[] = [],
    title = row.titulo ?? 'Cuestionario histórico',
    source: 'snapshot' | 'legacy' = 'legacy';
  if (row.snapshot_json) {
    const snapshot: unknown = JSON.parse(row.snapshot_json);
    if (
      !object(snapshot) ||
      snapshot.id !== row.id ||
      snapshot.owner !== row.owner ||
      snapshot.environment !== row.environment ||
      snapshot.submittedAt !== row.fecha_confirmacion ||
      canonical(snapshot.answers) !== canonical(answers) ||
      !object(snapshot.definition)
    )
      throw new Error('El snapshot del reporte no coincide con su captura.');
    const definition = snapshot.definition as unknown as DefinitionSnapshot;
    if (
      String(definition.form.id) !== row.formulario_id ||
      String(definition.form.version) !== row.version
    )
      throw new Error('La edición del reporte no coincide con su captura.');
    questions = contractForm(definition).preguntas;
    title = String(definition.form.titulo);
    source = 'snapshot';
  } else if (fallbackQuestions && fallbackQuestions.length) {
    questions = [...fallbackQuestions];
  }
  if (
    Object.values(answers).some(
      (v) =>
        v !== null &&
        typeof v !== 'string' &&
        typeof v !== 'boolean' &&
        !(typeof v === 'number' && Number.isFinite(v)) &&
        !(Array.isArray(v) && v.every((i) => typeof i === 'string')),
    )
  )
    throw new Error('Valor de respuesta no compatible.');
  const order = questions.length
    ? questions.map((q) => q.id).filter((id) => Object.hasOwn(answers, id))
    : Object.keys(answers).sort();
  if (questions.length && Object.keys(answers).some((id) => !questions.some((q) => q.id === id)))
    throw new Error('Respuesta ajena a la edición histórica.');
  return Object.freeze({
    id: row.id,
    formId: row.formulario_id,
    version: row.version,
    title,
    capturedAt: row.fecha_confirmacion,
    status: row.status ?? 'guardado_local',
    source,
    answers: Object.freeze(
      order.map((id) => {
        const q = questions.find((question) => question.id === id);
        return Object.freeze({
          code: q?.codigo ?? id,
          question: q?.titulo ?? 'Pregunta ' + id,
          value: label(q, answers[id]),
        });
      }),
    ),
  });
}
