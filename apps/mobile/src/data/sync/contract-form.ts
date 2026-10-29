import {
  type FormEdition,
  type FormQuestion,
  deriveConditionsVersion,
  validateFormDefinition,
} from '@quimiocare/contracts/forms';
import { completeDefinition, type DefinitionSnapshot } from './catalog';
import { object } from '../../services/session/response-checks';

export function contractForm(snapshot: DefinitionSnapshot): FormEdition {
  const complete = completeDefinition(snapshot.form, snapshot.questions);
  const config = complete.form.configuracion;
  if (!object(config)) throw new Error('Configuración del formulario incompleta.');
  const questions = complete.questions as unknown as FormQuestion[];
  const result: FormEdition = {
    id: String(complete.form.id),
    version: Number(complete.form.version),
    version_condiciones: deriveConditionsVersion(config, questions),
    ...(Object.hasOwn(config, 'version_reglas_compuestas')
      ? { version_reglas_compuestas: config.version_reglas_compuestas as number }
      : {}),
    preguntas: questions,
  };
  validateFormDefinition(result);
  return result;
}
export function formSections(
  snapshot: DefinitionSnapshot,
): { id: string; titulo: string; orden: number }[] {
  const config = snapshot.form.configuracion;
  const modules = [
    ...new Set(
      snapshot.questions.map((q) =>
        String(object(q.configuracion) ? (q.configuracion.modulo ?? 'general') : 'general'),
      ),
    ),
  ];
  if (!object(config) || !Object.hasOwn(config, 'secciones'))
    return modules.map((id, orden) => ({ id, titulo: String(snapshot.form.titulo), orden }));
  if (!Array.isArray(config.secciones) || !config.secciones.length)
    throw new Error('Las secciones del cuestionario no son compatibles.');
  const sections = config.secciones;
  if (
    sections.some(
      (s) =>
        !object(s) ||
        typeof s.id !== 'string' ||
        !s.id ||
        typeof s.titulo !== 'string' ||
        !Number.isInteger(s.orden),
    ) ||
    new Set(sections.map((s) => s.id)).size !== sections.length ||
    modules.some((id) => !sections.some((s) => s.id === id))
  )
    throw new Error('Las secciones del cuestionario no son compatibles.');
  return (sections as { id: string; titulo: string; orden: number }[])
    .slice()
    .sort((a, b) => a.orden - b.orden);
}
