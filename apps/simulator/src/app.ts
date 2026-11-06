import { prepare, requireOperator, getSyncedSigns, getSyncedEpro } from './preparation.js';
import { clinicalCrud, clinicalCrudPath } from './preparation-clinical-crud.js';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import {
  fixtureImageUrl,
  parseQuery,
  validateRequest,
  validateResponse,
} from '@quimiocare/contracts';
import type { OperationId } from '@quimiocare/contracts';
import type { Database } from './db.js';
import { transaction } from './db.js';
import type { SimulatorConfig } from './config.js';
import { ApiError, record } from './errors.js';
import {
  issueSession,
  operatorFromHeader,
  principalFromHeader,
  refreshSession,
  verifyControl,
} from './auth.js';
import { applyScenario, guardScenario } from './scenarios.js';
import { PATIENTS, SCENARIOS } from './types.js';
import type { DemoPatient, EproInput, ObjectValue, Scenario, SignsInput } from './types.js';
import { ACTIVE_FORMS, resetDatabase } from './seed-data.js';
import { acceptConsent, consentStatus, currentTermsId, getTerms } from './consent.js';
import {
  completeProfile,
  consumeLinkCode,
  createLinkCode,
  formForScenario,
  patientData,
  recordEpro,
  recordSign,
  recordSignBatch,
} from './clinical.js';
import { loadForm } from './forms.js';
import { educationCategories, educationDetail, listEducation } from './education.js';
import { serveEducationMaterial } from './education-materials.js';
import { handleSwaggerRoute } from './docs/swagger.js';
import {
  drainPublishes,
  handlePublishEducation,
  setMaintenanceActive,
} from './education-publish.js';
import { executeAiChat } from './ai.js';

interface Result {
  status: number;
  body: unknown;
  dropResponse?: boolean;
}

async function jsonBody(req: IncomingMessage, limit = 262144): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string);
    size += chunk.length;
    if (size > limit)
      throw new ApiError(413, 'CUERPO_DEMASIADO_GRANDE', 'Solicitud demasiado grande.');
    chunks.push(chunk);
  }
  if (!size) return undefined;
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'TIPO_NO_ADMITIDO', 'Se requiere application/json.');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ApiError(422, 'ERROR_VALIDACION', 'JSON inválido.');
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
    'access-control-allow-headers':
      'authorization, content-type, x-operation-id, accept, origin, x-requested-with',
  });
  res.end(encoded);
}

function validateInput(
  operation: OperationId,
  body: unknown,
  query: ObjectValue,
  path: ObjectValue,
) {
  const result = validateRequest(operation, { body, query, path });
  if (!result.valid)
    throw new ApiError(
      422,
      'ERROR_VALIDACION',
      'Solicitud incompatible con el contrato.',
      result.errors,
    );
}

function sendResult(res: ServerResponse, operation: OperationId, result: Result): void {
  const validation = validateResponse(operation, result.status, result.body);
  if (!validation.valid)
    throw new ApiError(
      500,
      'ERROR_INTERNO_SERVIDOR',
      'Respuesta sintética incompatible con el contrato.',
    );
  if (result.dropResponse) {
    // The database transaction has COMMITTED before this function is called.
    res.destroy();
    return;
  }
  send(res, result.status, result.body);
}

function operationFor(
  pathname: string,
  method: string,
): { id: OperationId; params: ObjectValue } | undefined {
  const routes: [string, string, OperationId][] = [
    ['GET', '/api/v1/auth/me', 'C-01'],
    ['POST', '/api/v1/auth/completar-perfil-paciente', 'C-02'],
    ['GET', '/api/v1/pacientes/me/perfil-clinico', 'C-03'],
    ['GET', '/api/v1/pacientes/me/tratamiento-activo', 'C-04'],
    ['POST', '/api/v1/pacientes/me/codigo-vinculacion', 'C-05'],
    ['POST', '/api/v1/pacientes/me/signos-vitales', 'C-06'],
    ['POST', '/api/v1/pacientes/me/signos-vitales/sync', 'C-07'],
    ['GET', '/api/v1/formularios/activo', 'C-08'],
    ['GET', '/api/v1/contenido-educativo', 'C-11'],
    ['GET', '/api/v1/contenido-educativo/categorias', 'C-12'],
    ['GET', '/api/v1/terminos/vigente', 'C-14'],
    ['GET', '/api/v1/pacientes/me/consentimientos', 'C-15'],
    ['POST', '/api/v1/pacientes/me/consentimientos', 'C-16'],
    ['POST', '/api/v1/chat', 'IA-01'],
    ['POST', '/__demo/auth/session', 'D-01'],
    ['POST', '/__demo/auth/refresh', 'D-02'],
    ['GET', '/__demo/escenarios', 'D-03'],
    ['PUT', '/__demo/escenario-activo', 'D-04'],
    ['POST', '/__demo/reset', 'D-05'],
    ['GET', '/__demo/archivos/imagen-prueba.png', 'D-06'],
  ];
  const exact = routes.find(([m, p]) => m === method && p === pathname);
  if (exact) return { id: exact[2], params: {} };
  const form = /^\/api\/v1\/formularios\/([^/]+)(\/respuestas)?$/.exec(pathname);
  if (form && ((method === 'POST' && form[2]) || (method === 'GET' && !form[2]))) {
    return { id: method === 'GET' ? 'C-09' : 'C-10', params: { formulario_id: form[1] } };
  }
  const content = /^\/api\/v1\/contenido-educativo\/([^/]+)$/.exec(pathname);
  if (content && method === 'GET') return { id: 'C-13', params: { contenido_id: content[1] } };
  return undefined;
}

export function createSimulator(config: SimulatorConfig, db: Database) {
  return createServer((req, res) => {
    void (async () => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
          'access-control-allow-headers':
            'authorization, content-type, x-operation-id, accept, origin, x-requested-with',
          'access-control-max-age': '86400',
        });
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', 'http://simulator.invalid');
      if (req.method === 'GET' && url.pathname === '/health') {
        try {
          await db.query('SELECT 1');
        } catch {
          throw new ApiError(503, 'SERVICIO_NO_DISPONIBLE', 'Base de datos no disponible.');
        }
        send(res, 200, { status: 'ok', service: config.service });
        return;
      }
      // Public general educational metadata only; no patient or operator data.
      if (
        config.service === 'clinical' &&
        req.method === 'GET' &&
        url.pathname.replace(/^\/quimiocare(?=\/)/, '') === '/educacion/api/v1/podcasts'
      ) {
        const result = await db.query(
          'SELECT drive_id AS id,titulo AS title,categoria AS category FROM qc_educacion_podcast WHERE activo=true AND NOT EXISTS(SELECT 1 FROM qc_preparacion_categoria c WHERE c.clave=lower(btrim(qc_educacion_podcast.categoria)) AND NOT c.activo) ORDER BY fecha_creacion,id LIMIT 1000',
        );
        send(res, 200, { episodios: result.rows });
        return;
      }
      if (await handleSwaggerRoute(config, db, req, res, url.pathname)) {
        return;
      }
      if (
        config.service === 'clinical' &&
        req.method === 'GET' &&
        (url.pathname.includes('/archivos/educacion/') ||
          url.pathname.startsWith('/__demo/archivos/educacion/'))
      ) {
        await serveEducationMaterial(config, db, url.pathname, res);
        return;
      }
      if (url.pathname.includes('/admin/api/') && !config.preparationEnabled)
        throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Preparacion deshabilitada.');
      const preparationPath = url.pathname.replace(/^\/quimiocare(?=\/)/, '');
      if (preparationPath === '/admin/api/v1/preparacion/acceso' && req.method === 'GET') {
        if (!config.preparationEnabled || config.service !== 'clinical')
          throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Preparacion deshabilitada.');
        const principal = await operatorFromHeader(config, req.headers.authorization, db);
        const id = await requireOperator(db, config, principal);
        send(res, 200, { autorizado: true, operador_id: id });
        return;
      }
      if (
        preparationPath === '/admin/api/v1/preparacion/sincronizacion/signos-vitales' &&
        req.method === 'GET'
      ) {
        if (!config.preparationEnabled || config.service !== 'clinical')
          throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Preparacion deshabilitada.');
        const principal = await operatorFromHeader(config, req.headers.authorization, db);
        const pacienteId = url.searchParams.get('paciente_id');
        if (!pacienteId)
          throw new ApiError(422, 'ERROR_VALIDACION', 'Falta el parámetro paciente_id.');
        const limiteParam = url.searchParams.get('limite');
        const limite = limiteParam ? Number(limiteParam) : 20;
        const result = await getSyncedSigns(db, config, principal, pacienteId, limite);
        send(res, result.status, result.body);
        return;
      }
      if (
        preparationPath === '/admin/api/v1/preparacion/sincronizacion/formularios-respuestas' &&
        req.method === 'GET'
      ) {
        if (!config.preparationEnabled || config.service !== 'clinical')
          throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Preparacion deshabilitada.');
        const principal = await operatorFromHeader(config, req.headers.authorization, db);
        const pacienteId = url.searchParams.get('paciente_id');
        if (!pacienteId)
          throw new ApiError(422, 'ERROR_VALIDACION', 'Falta el parámetro paciente_id.');
        const formularioId = url.searchParams.get('formulario_id') ?? undefined;
        const limiteParam = url.searchParams.get('limite');
        const limite = limiteParam ? Number(limiteParam) : 20;
        const result = await getSyncedEpro(db, config, principal, pacienteId, formularioId, limite);
        send(res, result.status, result.body);
        return;
      }
      if (preparationPath.startsWith('/admin/api/v1/preparacion/')) {
        const action = preparationPath.slice('/admin/api/v1/preparacion/'.length);
        const crud = clinicalCrudPath(action, req.method);
        if (action.startsWith('gestion/'))
          throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Ruta no encontrada.');
        if (
          !config.preparationEnabled ||
          config.service !== 'clinical' ||
          !(crud
            ? ['GET', 'POST', 'PUT', 'DELETE'].includes(req.method ?? '')
            : req.method === 'POST')
        )
          throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Preparacion deshabilitada.');
        const principal = await operatorFromHeader(config, req.headers.authorization, db);
        if (crud && req.method === 'GET') {
          await requireOperator(db, config, principal);
          const result = await clinicalCrud(db, 'GET', action, {});
          send(res, result.status, result.body);
          return;
        }
        const result =
          action === 'contenido-educativo/imagenes'
            ? await handlePublishEducation(config, db, principal, req)
            : await prepare(
                db,
                config,
                principal,
                crud ? `gestion/${req.method}/${action}` : action,
                record(await jsonBody(req, 262144)),
              );
        send(res, result.status, result.body);
        return;
      }
      if (
        config.service === 'clinical' &&
        req.method === 'POST' &&
        (url.pathname === '/admin/api/v1/contenido-educativo' ||
          url.pathname === '/quimiocare/admin/api/v1/contenido-educativo')
      ) {
        const principal = await operatorFromHeader(config, req.headers.authorization, db);
        const result = await handlePublishEducation(config, db, principal, req);
        send(res, result.status, result.body);
        return;
      }
      if (
        config.service === 'clinical' &&
        req.method === 'POST' &&
        (url.pathname === '/admin/api/v1/mantenimiento/pausar-publicacion' ||
          url.pathname === '/quimiocare/admin/api/v1/mantenimiento/pausar-publicacion')
      ) {
        const principal = await operatorFromHeader(config, req.headers.authorization, db);
        const opRow = (
          await db.query<{ id: string }>(
            'SELECT id FROM qc_demo_operador WHERE auth_issuer=$1 AND auth_subject=$2 AND activo=true',
            [principal.issuer ?? config.issuer, principal.id],
          )
        ).rows[0];
        if (!opRow)
          throw new ApiError(
            403,
            'OPERADOR_NO_AUTORIZADO',
            'No tienes permisos de operador clínico.',
          );
        setMaintenanceActive(true);
        const drained = await drainPublishes(15000);
        if (!drained) {
          setMaintenanceActive(false);
          throw new ApiError(
            504,
            'TIMEOUT_DRENAJE',
            'El drenaje de peticiones activas superó los 15 segundos.',
          );
        }
        send(res, 200, { ok: true, mantenimiento: true, active_publishes: 0 });
        return;
      }
      if (
        config.service === 'clinical' &&
        req.method === 'POST' &&
        (url.pathname === '/admin/api/v1/mantenimiento/reanudar-publicacion' ||
          url.pathname === '/quimiocare/admin/api/v1/mantenimiento/reanudar-publicacion')
      ) {
        const principal = await operatorFromHeader(config, req.headers.authorization, db);
        const opRow = (
          await db.query<{ id: string }>(
            'SELECT id FROM qc_demo_operador WHERE auth_issuer=$1 AND auth_subject=$2 AND activo=true',
            [principal.issuer ?? config.issuer, principal.id],
          )
        ).rows[0];
        if (!opRow)
          throw new ApiError(
            403,
            'OPERADOR_NO_AUTORIZADO',
            'No tienes permisos de operador clínico.',
          );
        setMaintenanceActive(false);
        send(res, 200, { ok: true, mantenimiento: false });
        return;
      }
      if (
        config.service === 'clinical' &&
        req.method === 'GET' &&
        (url.pathname === '/admin' ||
          url.pathname === '/admin/' ||
          url.pathname === '/admin/index.html' ||
          url.pathname === '/quimiocare/admin' ||
          url.pathname === '/quimiocare/admin/')
      ) {
        if (!config.apiDocsEnabled || !config.preparationEnabled)
          throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Preparacion deshabilitada.');
        res.writeHead(308, {
          location:
            (url.pathname.startsWith('/quimiocare/') ? '/quimiocare' : '') + '/docs/preparacion/',
          'cache-control': 'no-store',
        });
        res.end();
        return;
      }
      if (
        config.service === 'clinical' &&
        req.method === 'POST' &&
        (url.pathname === '/admin/api/v1/vinculaciones/consumir' ||
          url.pathname === '/quimiocare/admin/api/v1/vinculaciones/consumir')
      ) {
        const principal = await operatorFromHeader(config, req.headers.authorization, db);
        const raw = await jsonBody(req, 16384);
        const body = record(raw);
        if (typeof body.codigo !== 'string' || typeof body.plantilla_id !== 'string') {
          throw new ApiError(422, 'ERROR_VALIDACION', 'codigo y plantilla_id requeridos.');
        }
        const result = await consumeLinkCode(
          db,
          principal.id,
          body.codigo as string,
          body.plantilla_id as string,
          typeof body.request_token === 'string' ? (body.request_token as string) : undefined,
          principal.issuer ?? config.issuer,
        );
        send(res, result.status, result.body);
        return;
      }
      const route = operationFor(url.pathname, req.method ?? 'GET');
      if (url.pathname === '/health' && req.method === 'GET') {
        try {
          await db.query('SELECT 1');
          send(res, 200, { ok: true, service: `quimiocare-demo-${config.service}` });
        } catch {
          send(res, 503, { ok: false, service: `quimiocare-demo-${config.service}` });
        }
        return;
      }
      if (
        config.service === 'clinical' &&
        req.method === 'GET' &&
        url.pathname === '/api/v1/pacientes/me/equipo-tratante-demo'
      ) {
        const principal = await principalFromHeader(config, req.headers.authorization);
        await guardScenario(db, principal, false);
        const result = await db.query(
          `SELECT md5(r.id::text || r.operador_id::text)::uuid AS id, r.paciente_id, r.operador_id AS profesional_id,
                  r.vinculado_en, p.nombre, p.especialidad
           FROM qc_demo_relacion_clinica r
           JOIN qc_demo_profesional p ON p.operador_id=r.operador_id AND p.activo=true
           JOIN qc_demo_operador o ON o.id=r.operador_id AND o.activo=true
           WHERE r.paciente_id=$1 AND r.estado='activa' AND r.profesional_activo=true`,
          [principal.id],
        );
        send(res, 200, { paciente_id: principal.id, origen: 'simulacion', items: result.rows });
        return;
      }
      if (!route || (config.service === 'ai' ? route.id !== 'IA-01' : route.id === 'IA-01')) {
        throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Ruta no encontrada.');
      }
      const { id, params } = route;
      if (config.appEnv === 'universidad-demo' && id.startsWith('D-') && id !== 'D-06')
        throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Ruta no encontrada.');
      const isControl = ['D-03', 'D-04', 'D-05'].includes(id);
      if (isControl)
        verifyControl(
          config,
          typeof req.headers['x-demo-control'] === 'string'
            ? req.headers['x-demo-control']
            : undefined,
        );
      const isPublic = id.startsWith('D-') || id === 'C-14';
      const principal =
        !isPublic || (id === 'C-14' && req.headers.authorization)
          ? await principalFromHeader(config, req.headers.authorization)
          : undefined;
      const state = principal
        ? await guardScenario(
            db,
            principal,
            ['C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-14', 'C-15', 'C-16'].includes(id),
          )
        : undefined;
      const body = await jsonBody(req, id.startsWith('D-') ? 16384 : 262144);
      const query = parseQuery(id, url.searchParams) as ObjectValue;
      validateInput(id, body, query, params);
      let result: Result;
      switch (id) {
        case 'D-01':
          result = {
            status: 200,
            body: await issueSession(db, config, record(body).paciente_demo as DemoPatient),
          };
          break;
        case 'D-02':
          result = {
            status: 200,
            body: await refreshSession(db, config, record(body).refresh_token as string),
          };
          break;
        case 'D-03':
          result = {
            status: 200,
            body: {
              items: SCENARIOS.map((scenario) => ({
                id: scenario,
                descripcion: `Escenario sintético reproducible ${scenario}.`,
              })),
            },
          };
          break;
        case 'D-04': {
          const input = record(body);
          const applied = await applyScenario(
            db,
            PATIENTS[input.paciente_demo as DemoPatient],
            input.escenario as Scenario,
          );
          result = {
            status: 200,
            body: {
              paciente_demo: input.paciente_demo,
              escenario: applied.escenario,
              aplicado_en: applied.aplicado_en.toISOString(),
            },
          };
          break;
        }
        case 'D-05':
          await resetDatabase(db, config.publicBaseUrl);
          result = {
            status: 200,
            body: { seed: 'quimiocare-rc32-v1', reiniciado_en: new Date().toISOString() },
          };
          break;
        case 'D-06': {
          const bytes = await readFile(fixtureImageUrl);
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-length': bytes.length,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
            'access-control-allow-headers':
              'authorization, content-type, x-operation-id, accept, origin, x-requested-with',
          });
          res.end(bytes);
          return;
        }
        case 'C-01':
          result = { status: 200, body: await patientData(db, principal!.id, 'perfil') };
          break;
        case 'C-02':
          result = { status: 200, body: await completeProfile(db, principal!.id, record(body)) };
          break;
        case 'C-03':
          result = { status: 200, body: await patientData(db, principal!.id, 'perfil_clinico') };
          break;
        case 'C-04':
          result = { status: 200, body: await patientData(db, principal!.id, 'tratamiento') };
          break;
        case 'C-05':
          result = { status: 201, body: await createLinkCode(db, principal!.id) };
          break;
        case 'C-06':
          result = await recordSign(db, principal!.id, body as SignsInput);
          break;
        case 'C-07':
          result = await recordSignBatch(
            db,
            principal!.id,
            (Array.isArray(body) ? body : record(body).registros) as SignsInput[],
          );
          break;
        case 'C-08': {
          if (query.tipo_tratamiento !== undefined && query.tipo_tratamiento !== 'quimioterapia')
            throw new ApiError(
              404,
              'FORMULARIO_NO_ENCONTRADO',
              'No hay formulario para ese tratamiento.',
            );
          const selected = await db.query<{ formulario_id: string }>(
            'SELECT formulario_id FROM qc_preparacion_formulario_vigente WHERE tratamiento=$1',
            [query.tipo_tratamiento ?? 'quimioterapia'],
          );
          result = {
            status: 200,
            body: await loadForm(
              db,
              (!['EDICION_CONDICIONAL', 'EXCLUSIVIDAD_ACTIVA'].includes(state!.escenario)
                ? selected.rows[0]?.formulario_id
                : undefined) ??
                formForScenario(
                  state!,
                  ACTIVE_FORMS.map((form) => form.id),
                ),
            ),
          };
          break;
        }
        case 'C-09':
          result = { status: 200, body: await loadForm(db, String(params.formulario_id)) };
          break;
        case 'C-10':
          result = await recordEpro(
            db,
            principal!.id,
            String(params.formulario_id),
            body as EproInput,
          );
          break;
        case 'C-11':
          result = { status: 200, body: await listEducation(db, query) };
          break;
        case 'C-12':
          result = { status: 200, body: await educationCategories(db) };
          break;
        case 'C-13':
          result = { status: 200, body: await educationDetail(db, String(params.contenido_id)) };
          break;
        case 'C-14':
          result = {
            status: 200,
            body: await getTerms(
              db,
              await currentTermsId(state, db, query.codigo as string | undefined),
              query.codigo as string | undefined,
            ),
          };
          break;
        case 'C-15':
          result = {
            status: 200,
            body: await consentStatus(
              db,
              principal!.id,
              state!,
              query.codigo as string | undefined,
            ),
          };
          break;
        case 'C-16':
          result = await transaction(db, (client) =>
            acceptConsent(
              client,
              principal!.id,
              state!,
              body as { definicion_terminos_id: string; operacion_id: string; codigo?: string },
            ),
          );
          break;
        case 'IA-01': {
          const input = record(body);
          if (Object.keys(input).some((key) => !['mensaje', 'activar_alarmas'].includes(key))) {
            throw new ApiError(
              422,
              'ERROR_VALIDACION',
              'La consulta no admite historial ni campos adicionales.',
            );
          }
          const incomingRequestId =
            typeof req.headers['x-request-id'] === 'string'
              ? req.headers['x-request-id']
              : undefined;
          result = {
            status: 200,
            body: await executeAiChat(
              config,
              state!,
              String(input.mensaje),
              input.activar_alarmas !== false,
              query.debug === true,
              incomingRequestId,
            ),
          };
          break;
        }
        default:
          throw new ApiError(404, 'RECURSO_NO_ENCONTRADO', 'Ruta no encontrada.');
      }
      sendResult(res, id, result);
    })().catch((error: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(500, 'ERROR_INTERNO_SERVIDOR', 'Fallo interno del simulador.');
      const path = req.url?.split('?')[0] ?? '';
      if (config.service === 'ai')
        send(res, apiError.status, {
          detail: apiError.status === 422 ? [{ msg: apiError.message }] : apiError.message,
        });
      else if (path.startsWith('/__demo/'))
        send(res, apiError.status, { error: { codigo: apiError.code, mensaje: apiError.message } });
      else
        send(res, apiError.status, {
          error: {
            codigo: apiError.code,
            mensaje: apiError.message,
            detalles: apiError.details,
            status_code: apiError.status,
          },
        });
    });
  });
}
