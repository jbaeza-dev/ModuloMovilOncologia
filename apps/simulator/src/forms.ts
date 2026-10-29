import {
  deriveConditionsVersion,
  validateFormDefinition,
  validateFormAnswers,
  FormRuleError,
} from '@quimiocare/contracts/forms';
import type { SqlClient } from './db.js';
import { one } from './db.js';
import { ApiError } from './errors.js';
import type { AnswerInput, FormDefinition, ObjectValue, Question } from './types.js';

function boundary<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof FormRuleError)
      throw new ApiError(422, error.code, error.message, error.details);
    throw error;
  }
}
export function conditionsVersion(config: ObjectValue, questions: Question[]): 0 | 1 {
  return boundary(() => deriveConditionsVersion(config, questions));
}
export function validateDefinition(form: FormDefinition): void {
  boundary(() => validateFormDefinition(form));
}
export async function loadForm(client: SqlClient, id: string): Promise<FormDefinition> {
  const row = await one<{
    id: string;
    codigo: string;
    titulo: string;
    descripcion: string | null;
    tratamiento: string;
    version: number;
    activo: boolean;
    configuracion: ObjectValue;
    fecha_creacion: Date;
  }>(client, 'SELECT * FROM formulario WHERE id=$1 AND eliminado=false', [id]);
  if (!row) throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Formulario no encontrado.');
  const questions = (
    await client.query<Question>(
      `SELECT id,codigo,titulo,texto,tipo,requerida,orden,opciones,configuracion
    FROM pregunta WHERE formulario_id=$1 AND eliminado=false ORDER BY orden,id`,
      [id],
    )
  ).rows;
  const form: FormDefinition = {
    id: row.id,
    codigo: row.codigo,
    titulo: row.titulo,
    descripcion: row.descripcion,
    tratamiento: row.tratamiento,
    version: row.version,
    activo: row.activo,
    fecha_creacion: row.fecha_creacion.toISOString(),
    preguntas: questions,
    configuracion: row.configuracion,
    ...(Object.hasOwn(row.configuracion, 'version_reglas_compuestas')
      ? { version_reglas_compuestas: row.configuracion.version_reglas_compuestas as number }
      : {}),
    version_condiciones: conditionsVersion(row.configuracion, questions),
  };
  validateDefinition(form);
  return form;
}

export function validateAnswers(form: FormDefinition, answers: AnswerInput[]) {
  return boundary(() => validateFormAnswers(form, answers));
}
