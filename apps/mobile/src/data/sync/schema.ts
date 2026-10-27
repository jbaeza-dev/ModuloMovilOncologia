import { column, Schema, Table } from '@powersync/common';

const command = () =>
  new Table(
    {
      owner: column.text,
      environment: column.text,
      captured_at: column.text,
      payload_json: column.text,
      legacy_queue_id: column.text,
    },
    { insertOnly: true },
  );

// Only these three server projections are replicated. Patient history stays local.
export const clinicalSyncSchema = new Schema({
  formulario: new Table({
    codigo: column.text,
    titulo: column.text,
    descripcion: column.text,
    tratamiento: column.text,
    version: column.integer,
    activo: column.integer,
    configuracion: column.text,
    fecha_creacion: column.text,
    eliminado: column.integer,
  }),
  pregunta: new Table(
    {
      formulario_id: column.text,
      codigo: column.text,
      titulo: column.text,
      texto: column.text,
      tipo: column.text,
      requerida: column.integer,
      orden: column.integer,
      opciones: column.text,
      configuracion: column.text,
      eliminado: column.integer,
    },
    { indexes: { edition: ['formulario_id', 'orden'] } },
  ),
  contenido_educativo: new Table({
    titulo: column.text,
    descripcion: column.text,
    tipo: column.text,
    url: column.text,
    categoria: column.text,
    carpeta_id: column.text,
    activo: column.integer,
    fecha_creacion: column.text,
    archivo_mime: column.text,
    archivo_tamano_bytes: column.integer,
    archivo_revision: column.text,
    archivo_sha256: column.text,
  }),
  qc_upload_signos: command(),
  qc_upload_epro: command(),
});
