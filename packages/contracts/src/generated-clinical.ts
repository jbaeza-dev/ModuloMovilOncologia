// Generated from the unchanged upstream schemas. Run pnpm generate; do not edit.
// Numeric/string limits and conditional business constraints are checked at runtime.

export type ClinicalAlergiaResponse = {
  "id": string;
  "alergeno_id": string;
  "nombre"?: string;
  "severidad"?: string;
};

export type ClinicalAntecedenteFamiliarResponse = {
  "id": string;
  "condicion_id": string;
  "nombre"?: string;
  "codigo_cie10"?: (string | null);
  "grado_familiar"?: string;
};

export type ClinicalCategoriaListResponse = {
  "categorias": Array<string>;
};

export type ClinicalCodigoVinculacionResponse = {
  "codigo": string;
  "fecha_expiracion": string;
  "mensaje"?: string;
};

export type ClinicalCompletarPerfilPacienteRequest = {
  "rut": string;
  "telefono"?: (string | null);
  "fecha_nacimiento"?: (string | null);
  "sexo"?: (string | null);
};

export type ClinicalCondicionResponse = {
  "id": string;
  "condicion_id": string;
  "nombre"?: string;
  "codigo_cie10"?: (string | null);
  "fecha_diagnostico"?: (string | null);
  "categoria"?: string;
  "en_tratamiento"?: boolean;
};

export type ClinicalContenidoEducativoResponse = {
  "id": string;
  "profesional_id": string;
  "titulo": string;
  "descripcion": string;
  "tipo": "imagen" | "video";
  "url": string;
  "categoria": string;
  "activo": boolean;
  "fecha_creacion": string;
  "carpeta_id"?: (string | null);
  "archivo_mime": ("image/png" | "image/jpeg" | null);
  "archivo_tamano_bytes": (number | null);
  "archivo_revision": (string | null);
  "archivo_sha256": (string | null);
};

export type ClinicalDefinicionTerminosResponse = {
  "id": string;
  "codigo": string;
  "titulo": string;
  "version": string;
  "texto_completo": string;
  "contenido"?: (string | null);
  "descripcion"?: (string | null);
  "vigente_desde": string;
  "vigente_hasta"?: (string | null);
  "vigente"?: boolean;
  "obligatorio"?: boolean;
  "creado_el"?: (string | null);
};

export type ClinicalErrorReal = {
  "error": ClinicalErrorRealDetalle;
};

export type ClinicalErrorRealDetalle = {
  "codigo": string;
  "mensaje": string;
  "detalles"?: unknown;
  "status_code": number;
};

export type ClinicalFormularioResponseSchema = {
  "id": string;
  "codigo": string;
  "titulo": string;
  "descripcion"?: (string | null);
  "tratamiento": string;
  "version": number;
  "activo": boolean;
  "version_condiciones": number;
  "preguntas": Array<ClinicalPreguntaSchema>;
  "fecha_creacion": string;
};

export type ClinicalItemRespuestaDetalleSchema = {
  "pregunta_id": string;
  "codigo_pregunta": string;
  "texto_pregunta": string;
  "tipo_pregunta": string;
  "valor": unknown;
  "valor_texto"?: (string | null);
};

export type ClinicalItemRespuestaInputSchema = {
  "pregunta_id": string;
  "valor": unknown;
  "valor_texto"?: (string | null);
};

export type ClinicalListaContenidoResponse = {
  "total": number;
  "contenidos": Array<ClinicalContenidoEducativoResponse>;
};

export type ClinicalMedicamentoResponse = {
  "id": string;
  "medicamento_id": string;
  "nombre"?: string;
  "dosis"?: string;
  "frecuencia"?: string;
  "motivo"?: string;
  "activo"?: boolean;
  "fecha_inicio"?: (string | null);
  "fecha_termino"?: (string | null);
};

export type ClinicalOpcionPreguntaSchema = {
  "codigo": string;
  "etiqueta": string;
  "orden"?: number;
};

export type ClinicalPerfilClinicoResponse = {
  "id": string;
  "grupo_sanguineo"?: string;
  "peso"?: (number | null);
  "altura"?: (number | null);
  "tabaquismo"?: (boolean | null);
  "consumo_alcohol"?: (boolean | null);
  "actividad_fisica"?: string;
  "fecha_actualizacion": string;
  "medicamentos"?: Array<ClinicalMedicamentoResponse>;
  "alergias"?: Array<ClinicalAlergiaResponse>;
  "condiciones"?: Array<ClinicalCondicionResponse>;
  "antecedentes_familiares"?: Array<ClinicalAntecedenteFamiliarResponse>;
};

export type ClinicalPreguntaSchema = {
  "id": string;
  "codigo": string;
  "titulo": string;
  "texto"?: (string | null);
  "tipo": "texto_libre" | "numerico" | "opcion_unica" | "opcion_multiple" | "escala_likert" | "booleano";
  "requerida"?: boolean;
  "orden": number;
  "opciones"?: Array<ClinicalOpcionPreguntaSchema>;
  "configuracion"?: Record<string, unknown>;
};

export type ClinicalResponderFormularioRequestSchema = {
  "id": string;
  "fecha_respuesta": string;
  "respuestas": Array<ClinicalItemRespuestaInputSchema>;
  "comentario"?: (string | null);
};

export type ClinicalResponderFormularioResponseSchema = {
  "id": string;
  "formulario_id": string;
  "formulario_version": number;
  "paciente_id": string;
  "fecha_respuesta_cliente": string;
  "fecha_recepcion_servidor"?: (string | null);
  "respuestas": Array<ClinicalItemRespuestaDetalleSchema>;
  "comentario"?: (string | null);
  "mensaje"?: string;
};

export type ClinicalSignoVitalRegistroInput = {
  "id": string;
  "fecha_registro": string;
  "presion_arterial_sistolica"?: (number | null);
  "presion_arterial_diastolica"?: (number | null);
  "pulso"?: (number | null);
  "temperatura"?: (number | null);
  "saturacion_oxigeno"?: (number | null);
};

export type ClinicalSignoVitalResponse = {
  "id": string;
  "fecha_registro": string;
  "presion_arterial_sistolica"?: (number | null);
  "presion_arterial_diastolica"?: (number | null);
  "pulso"?: (number | null);
  "temperatura"?: (number | null);
  "saturacion_oxigeno"?: (number | null);
  "fecha_subida"?: (string | null);
  "sincronizado"?: boolean;
};

export type ClinicalSincronizarSignosLoteRequest = {
  "registros": Array<ClinicalSignoVitalRegistroInput>;
};

export type ClinicalSincronizarSignosResponse = {
  "insertados"?: Array<ClinicalSignoVitalResponse>;
  "ya_existentes"?: Array<ClinicalSignoVitalResponse>;
  "total_insertados": number;
  "total_ya_existentes": number;
  "total_procesados": number;
};

export type ClinicalTratamientoActivoResponse = {
  "id": string;
  "tipo_tratamiento_id": string;
  "tipo_tratamiento_codigo": string;
  "tipo_tratamiento_nombre": string;
  "codigo_icd10"?: (string | null);
  "fase"?: (string | null);
  "estado"?: string;
  "intencion"?: (string | null);
  "parametros"?: Record<string, unknown>;
  "fecha_inicio_tratamiento"?: (string | null);
  "fecha_termino_tratamiento"?: (string | null);
  "activo"?: boolean;
};

export type ClinicalUsuarioPerfilResponse = {
  "id": string;
  "email": string;
  "nombre"?: (string | null);
  "rut"?: (string | null);
  "rol": string;
  "activo": boolean;
  "estado_incorporacion"?: string;
  "foto_url"?: (string | null);
  "telefono"?: (string | null);
  "fecha_nacimiento"?: (string | null);
  "sexo"?: (string | null);
  "especialidad"?: (string | null);
};

export type ClinicalRegistrarConsentimientoRequest = {
  "definicion_terminos_id": string;
  "operacion_id": string;
  "codigo"?: string;
};

export type ClinicalConsentimientoResponse = {
  "id": string;
  "paciente_id": string;
  "definicion_terminos_id": string;
  "version_codigo"?: (string | null);
  "version_numero"?: (string | null);
  "otorgado_el": string;
  "revocado": boolean;
  "revocado_el"?: (string | null);
  "ip_address"?: (string | null);
  "user_agent"?: (string | null);
};

export type ClinicalDefinicionTerminosVigenteResponse = {
  "id": string;
  "codigo": string;
  "titulo": string;
  "descripcion"?: (string | null);
  "version": string;
  "texto_completo": string;
  "obligatorio": boolean;
  "vigente_desde": string;
};

export type ClinicalEstadoConsentimientoResponse = {
  "requiere_aceptacion": boolean;
  "terminos_vigentes"?: (ClinicalDefinicionTerminosVigenteResponse | null);
  "consentimiento_actual"?: (ClinicalConsentimientoResponse | null);
  "historial_previo"?: Array<ClinicalConsentimientoResponse>;
};

export type ClinicalConfiguracionEproRC32 = {
  "depende_de"?: string;
  "valor_activador"?: boolean | number | string;
  "requerida_si_activa"?: boolean;
  "min_value"?: number;
  "max_value"?: number;
  "max_length"?: number;
  "modulo"?: unknown;
  "es_madre"?: unknown;
  "id_web_original"?: unknown;
  "metadata"?: unknown;
  "opciones_exclusivas"?: Array<string>;
};
