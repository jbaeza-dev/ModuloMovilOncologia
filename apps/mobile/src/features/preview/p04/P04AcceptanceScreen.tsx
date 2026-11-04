import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { localAgendaData } from '../../../services/agenda/agenda-coordinator';
import { useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Screen } from '../../../components/Screen';
import { BodyText, InfoCard } from '../../../components/Visual';
import { useLocalData } from '../../../providers/LocalDataProvider';
import { createPatientRepository } from '../../../data/local/repository';
import { canonical, type ClinicalCommand } from '../../../data/sync/clinical-command';
import { inventoryLegacy } from '../../../data/sync/migration';
import { ExpoFileStorageAdapter } from '../../../data/local/files/file-storage-adapter';
import { createNativeFileCipher, encryptedFile } from '../../../data/sync/native-cipher';
import { computeSha256 } from '../../../utils/crypto';
import { isPathInPatientMediaDirectory } from '../../../data/local/files/educational-storage';
import { runEducationalPromotionProbe } from '../p05/file-promotion-probe';

/** Opt-in synthetic acceptance on the same provider/repositories used by the application. */
export default function P04AcceptanceScreen() {
  const { clinicalStore: store, patientId, trackOperation } = useLocalData();
  const params = useLocalSearchParams<{ run?: string; action?: string; phase?: string }>();
  const [display, setDisplay] = useState('Preparando comprobación de la aplicación…');
  useEffect(() => {
    if (!store || !patientId || !params.run || !params.action) return;
    if (
      !/^[a-z0-9-]{1,64}$/.test(params.run) ||
      !['snapshot', 'capture', 'draft', 'resume', 'education-crash', 'p07-reports'].includes(
        params.action,
      )
    )
      return;
    const run = params.run,
      action = params.action,
      activeStore = store;
    let active = true;
    void trackOperation(async () => {
      const result: Record<string, unknown> = {
        run,
        action,
        startedAt: new Date().toISOString(),
        passed: false,
        owner: activeStore.scope.owner,
        patientId,
      };
      const db = activeStore.connection;
      try {
        if (action === 'p07-reports') {
          const { runReportProbe } = await import('../p07/report-probe');
          result.reportProbe = await runReportProbe(patientId, run);
          if (!(result.reportProbe as { passed: boolean }).passed)
            throw new Error('La prueba de reportes contiene fallos; revisar cada muestra.');
        }
        if (action === 'education-crash')
          await runEducationalPromotionProbe(activeStore, patientId, run, params.phase);
        if (action === 'capture') {
          const marker = 'acceptance:' + run + ':capture';
          let row = await db.first<{ value_json: string }>(
            'SELECT value_json FROM qc_storage_control WHERE id=?',
            [marker],
          );
          if (!row) {
            const value = {
              id: Crypto.randomUUID(),
              queue: Crypto.randomUUID(),
              capturedAt: new Date().toISOString(),
            };
            await db.run('INSERT INTO qc_storage_control(id,value_json) VALUES (?,?)', [
              marker,
              canonical(value),
            ]);
            row = { value_json: canonical(value) };
          }
          const capture = JSON.parse(row.value_json) as {
            id: string;
            queue: string;
            capturedAt: string;
          };
          if (!(await db.first('SELECT id FROM qc_clinical_command WHERE id=?', [capture.id]))) {
            let first = true;
            await createPatientRepository(
              db,
              patientId,
              () => {
                if (first) {
                  first = false;
                  return capture.id;
                }
                return capture.queue;
              },
              () => capture.capturedAt,
              activeStore.captureHook,
            ).createVitals({
              dolor_ena: 0, // Synthetic laboratory capture, never a patient default.
              temperatura: 36.6,
              pulso: 72,
              presion_sistolica: 120,
              presion_diastolica: 80,
              saturacion_o2: 98,
            });
          }
          result.created = capture.id;
        }
        if (action === 'draft') {
          const form = await db.first<{ formulario_id: string; version: string }>(
            'SELECT formulario_id,version FROM formulario_cache ORDER BY formulario_id,version LIMIT 1',
          );
          if (!form) throw new Error('Falta una edición local para probar el borrador.');
          const key = 'p04-acceptance:' + run;
          await db.run(
            'INSERT OR IGNORE INTO borrador_formulario(paciente_id,formulario_id,version,periodo_clave,entrega_id,respuestas_json,guardado_en,version_payload) VALUES (?,?,?,?,?,?,?,2)',
            [
              patientId,
              form.formulario_id,
              form.version,
              key,
              Crypto.randomUUID(),
              canonical({ syntheticMarker: run }),
              new Date().toISOString(),
            ],
          );
          const cipher = await createNativeFileCipher(
            activeStore.scope.environment,
            activeStore.scope.owner,
            patientId,
            true,
          );
          const directory = new Directory(
            cipher.directory!('formularios_locales', patientId),
            'p04_acceptance',
          );
          directory.create({ intermediates: true, idempotent: true });
          const file = new File(directory, run + '.json'),
            adapter = new ExpoFileStorageAdapter();
          await adapter.writeText(file.uri, canonical({ syntheticMarker: run }));
          if (
            !encryptedFile(await file.bytes()) ||
            (await adapter.readText(file.uri)) !== canonical({ syntheticMarker: run })
          )
            throw new Error('El borrador de archivo no pasó cifrado/reapertura.');
          result.encryptedDraftFile = true;
        }
        if (action === 'resume') {
          await activeStore.resume(true);
          const until = Date.now() + 60000;
          while (Date.now() < until && (await activeStore.database.getUploadQueueStats()).count > 0)
            await new Promise((r) => setTimeout(r, 250));
          if ((await activeStore.database.getUploadQueueStats()).count > 0)
            throw new Error('Aún hay operaciones SDK pendientes.');
        }
        const inventory = await inventoryLegacy(db, activeStore.scope);
        result.counts = inventory.tables.map((t) => ({ table: t.name, rows: t.rows.length }));
        for (const table of inventory.tables.filter((t) => t.columns.includes('paciente_id'))) {
          if (
            (
              await db.first<{ n: number }>(
                'SELECT count(*) n FROM "' + table.name + '" WHERE paciente_id<>?',
                [patientId],
              )
            )?.n !== 0
          )
            throw new Error('Hay datos de otra cuenta.');
        }
        result.otherAccountRows = 0;
        result.commands = await Promise.all(
          (await db.all<ClinicalCommand>('SELECT * FROM qc_clinical_command ORDER BY id')).map(
            async (c) => ({
              id: c.id,
              owner: c.owner,
              capturedAt: c.captured_at,
              status: c.status,
              ack: !!c.ack_json,
              payloadSha256: await Crypto.digestStringAsync(
                Crypto.CryptoDigestAlgorithm.SHA256,
                c.payload_json,
              ),
            }),
          ),
        );
        result.sdkPending = (await activeStore.database.getUploadQueueStats()).count;
        // Read-only P05 evidence: identities/hashes and dates, never answer values or codes.
        result.operationalEvents = await db.all(
          'SELECT id,owner,record_id,kind,captured_at FROM qc_operational_event ORDER BY id',
        );
        result.eproLocal = await Promise.all(
          (
            await db.all<{ id: string; value_json: string }>(
              "SELECT id,value_json FROM qc_storage_control WHERE id LIKE 'epro:draft:%' OR id LIKE 'epro:capture:%' ORDER BY id",
            )
          ).map(async (row) => {
            const value = JSON.parse(row.value_json);
            return {
              key: row.id,
              id: value.id,
              owner: value.owner,
              environment: value.environment,
              formId: value.definition.form.id,
              edition: value.definition.form.version,
              instrumentVersion: value.definition.form.configuracion?.instrumento_version,
              definitionSha256: await computeSha256(canonical(value.definition)),
              context: value.context,
              section: value.section,
              revision: value.revision,
              answerCount: Object.keys(value.answers).length,
              answersSha256: await computeSha256(canonical(value.answers)),
              submittedAt: value.submittedAt ?? null,
            };
          }),
        );
        const link = await db.first<{ value_json: string }>(
          'SELECT value_json FROM qc_storage_control WHERE id=?',
          ['rest:link-code:' + activeStore.scope.owner],
        );
        if (link) {
          const value = JSON.parse(link.value_json);
          result.linkCode = {
            kind: value.kind,
            requestedAt: value.requestedAt,
            expiresAt: value.expiresAt ?? null,
            retryAfter: value.retryAfter ?? null,
            codeSha256:
              typeof value.code === 'string' ? await computeSha256(canonical(value.code)) : null,
          };
        }
        const copies = await createPatientRepository(
          db,
          patientId,
          Crypto.randomUUID,
        ).education.listLocalCopies();
        result.educationalCopies = [];
        for (const copy of copies) {
          const path = copy.rutaAbsoluta ?? copy.rutaRelativa;
          const contained =
            !!path && isPathInPatientMediaDirectory(path, patientId, copy.contentId);
          const file = contained ? new File(path) : null;
          const exists = !!file?.exists;
          const bytes = exists ? await file!.bytes() : null;
          (result.educationalCopies as unknown[]).push({
            contentId: copy.contentId,
            state: copy.estado ?? null,
            revision: copy.metadataLocal?.versionOrigen ?? null,
            downloadedAt: copy.descargadoEn,
            declaredReviewed: copy.revisionDeclarada,
            expectedBytes: copy.tamanoBytes,
            expectedSha256: copy.metadataLocal?.sha256 ?? null,
            contained,
            exists,
            observedBytes: bytes?.length ?? 0,
            observedSha256: bytes ? await computeSha256(bytes) : null,
          });
        }
        result.cipherVersion = (
          await db.first<{ cipher_version: string }>('PRAGMA cipher_version')
        )?.cipher_version;
        result.schemaVersion = (
          await db.first<{ user_version: number }>('PRAGMA user_version')
        )?.user_version;
        // Read-only P06 operational proof. Never include a token, clinical value or chat message.
        if (result.schemaVersion === 13) {
          result.presentedAgendaNotices = (await Notifications.getPresentedNotificationsAsync())
            .filter((n) => localAgendaData(n.request.content.data))
            .map((n) => ({ identifier: n.request.identifier, data: n.request.content.data }));
          result.nativeScheduledAgenda = (await Notifications.getAllScheduledNotificationsAsync())
            .filter((n) => localAgendaData(n.content.data))
            .map((n) => ({ identifier: n.identifier, data: n.content.data }));
          const scope = [activeStore.scope.owner, activeStore.scope.environment];
          result.agendaState = await db.all(
            'SELECT version,server_time,synchronized_at FROM qc_agenda_state WHERE owner=? AND environment=?',
            scope,
          );
          result.agendaRules = await db.all(
            'SELECT id FROM qc_agenda_rule WHERE owner=? AND environment=? ORDER BY id',
            scope,
          );
          result.agendaJobs = await db.all(
            'SELECT session_id,occurrence_id,native_id,backup_at,state,processed_at,claim_until FROM qc_agenda_job WHERE owner=? AND environment=? ORDER BY backup_at,occurrence_id',
            [...scope],
          );
          result.agendaCoverage = await db.all(
            'SELECT session_id,value_json FROM qc_agenda_coverage WHERE owner=? AND environment=?',
            scope,
          );
          result.gatewayOutbox = await db.all(
            'SELECT id,kind,body_json,status,acked_at,error_code FROM qc_gateway_outbox WHERE owner=? AND environment=? ORDER BY created_at,id',
            scope,
          );
          result.operationalSaveTimes = await db.all(
            'SELECT record_id,kind,registered_at,status FROM qc_operational_event WHERE owner=? ORDER BY id',
            [activeStore.scope.owner],
          );
        }
        result.catalog = await db.first(
          "SELECT completed_at,error_code FROM qc_catalog_status WHERE id='catalog'",
        );
        // Definition diagnostics contain metadata only, never answers or credentials.
        result.replicatedDefinitions = await db.all(
          'SELECT id,activo,configuracion FROM formulario ORDER BY id',
        );
        result.replicatedQuestionCounts = await db.all(
          'SELECT formulario_id,count(*) AS n FROM pregunta GROUP BY formulario_id ORDER BY formulario_id',
        );
        result.completeDefinitions = (
          await db.all<{ id: string; retired: number; snapshot_json: string }>(
            'SELECT id,retired,snapshot_json FROM qc_definition_snapshot ORDER BY id',
          )
        ).map((row) => {
          const snapshot = JSON.parse(row.snapshot_json) as {
            form: { activo: unknown; configuracion: unknown };
            questions: unknown[];
          };
          return {
            id: row.id,
            retired: row.retired,
            active: snapshot.form.activo,
            config: snapshot.form.configuracion,
            questions: snapshot.questions.length,
          };
        });
        result.passed = true;
      } catch (error) {
        result.error =
          error instanceof Error ? error.message : 'No se pudo completar el caso nativo.';
      } finally {
        result.finishedAt = new Date().toISOString();
        const directory = new Directory(Paths.document, 'p04_acceptance');
        directory.create({ intermediates: true, idempotent: true });
        new File(directory, run + '_' + action + '.json').write(JSON.stringify(result, null, 2));
        if (active) setDisplay(JSON.stringify(result, null, 2));
      }
    }).catch(() => {
      if (active) setDisplay('La cuenta cambió antes de completar la comprobación.');
    });
    return () => {
      active = false;
    };
  }, [store, patientId, params.run, params.action, params.phase, trackOperation]);
  return (
    <Screen title="Aceptación técnica P04">
      <InfoCard>
        <BodyText>
          Datos sintéticos. Usa la base cifrada y los repositorios de la aplicación.
        </BodyText>
        <BodyText>{display}</BodyText>
      </InfoCard>
    </Screen>
  );
}
