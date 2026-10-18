import type { FormAnswerValue } from '../../data/local/forms/form-types';

export interface FormDraftIdentity {
  formId: string;
  version: string;
  periodoClave: string;
  deliveryId: string;
}

export interface FormDraftControllerOptions {
  identity: FormDraftIdentity;
  onSave: (
    identity: { formId: string; version: string; periodoClave: string },
    answers: Record<string, FormAnswerValue>,
    currentSection?: string | null,
  ) => Promise<void>;
  onConfirm: (
    identity: FormDraftIdentity,
    answers: Record<string, FormAnswerValue>,
  ) => Promise<string>;
  debounceMs?: number;
}

/**
 * Controlador de guardado asíncrono para borradores de formularios.
 * Garantiza:
 * 1. Debounce configurable (300-500 ms) para campos de texto / entradas frecuentes.
 * 2. Serialización estricta: nunca ejecuta dos escrituras concurrentes sobre SQLite.
 * 3. Protección contra autosave lento: antes de confirmar, espera a que finalicen
 *    las escrituras en vuelo (flush). Una vez confirmada la entrega o descartado el borrador,
 *    cualquier llamada pendiente es cancelada sin recrear el borrador en base de datos.
 */
export class FormDraftController {
  private readonly identity: FormDraftIdentity;
  private readonly onSave: FormDraftControllerOptions['onSave'];
  private readonly onConfirm: FormDraftControllerOptions['onConfirm'];
  private readonly debounceMs: number;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPayload: {
    answers: Record<string, FormAnswerValue>;
    currentSection?: string | null;
  } | null = null;

  private inFlightPromise: Promise<void> | null = null;
  private isConfirmed = false;
  private isDisposed = false;

  constructor(options: FormDraftControllerOptions) {
    this.identity = options.identity;
    this.onSave = options.onSave;
    this.onConfirm = options.onConfirm;
    this.debounceMs = options.debounceMs ?? 400;
  }

  /**
   * Encola un guardado de borrador.
   * Si immediate es true (ej: cambio de sección o salida de pantalla), se ejecuta de inmediato.
   * Si no, se aplica debounce (ej: tipeo en campo de texto libre).
   */
  queueSave(
    answers: Record<string, FormAnswerValue>,
    currentSection?: string | null,
    immediate = false,
  ): void {
    if (this.isConfirmed || this.isDisposed) {
      return;
    }

    this.pendingPayload = { answers, currentSection };

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (immediate) {
      void this.executePendingSave();
    } else {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        void this.executePendingSave();
      }, this.debounceMs);
    }
  }

  /**
   * Procesa la escritura pendiente serializándola detrás de cualquier escritura en curso.
   */
  private async executePendingSave(): Promise<void> {
    if (this.isConfirmed || this.isDisposed) {
      this.pendingPayload = null;
      return;
    }

    if (!this.pendingPayload) {
      return;
    }

    // Si ya hay una escritura en vuelo, encadenar la ejecución para cuando termine
    if (this.inFlightPromise) {
      await this.inFlightPromise;
      if (this.isConfirmed || this.isDisposed) {
        this.pendingPayload = null;
        return;
      }
      return this.executePendingSave();
    }

    const current = this.pendingPayload;
    this.pendingPayload = null;

    const saveOperation = async () => {
      try {
        await this.onSave(
          {
            formId: this.identity.formId,
            version: this.identity.version,
            periodoClave: this.identity.periodoClave,
          },
          current.answers,
          current.currentSection,
        );
      } finally {
        this.inFlightPromise = null;
      }
    };

    this.inFlightPromise = saveOperation();
    await this.inFlightPromise;

    // Si mientras guardaba llegó otra actualización pendiente, ejecutarla
    if (this.pendingPayload && !this.isConfirmed && !this.isDisposed) {
      await this.executePendingSave();
    }
  }

  /**
   * Fuerza el vaciado inmediato de cualquier escritura pendiente o en curso.
   */
  async flush(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.pendingPayload) {
      await this.executePendingSave();
    }

    if (this.inFlightPromise) {
      await this.inFlightPromise;
    }
  }

  /**
   * Confirma la entrega diaria.
   * Cancela timers pendientes, espera a que las escrituras en vuelo terminen y ejecuta
   * onConfirm. Bloquea de forma irrevocable cualquier guardado posterior.
   */
  async confirm(answers: Record<string, FormAnswerValue>): Promise<string> {
    if (this.isConfirmed) {
      throw new Error('El seguimiento ya ha sido confirmado previamente.');
    }
    if (this.isDisposed) {
      throw new Error('El controlador ha sido destruido.');
    }

    // Cancelar cualquier debounce pendiente y esperar escrituras en vuelo
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingPayload = null;

    if (this.inFlightPromise) {
      await this.inFlightPromise;
    }

    this.isConfirmed = true;

    try {
      const deliveryId = await this.onConfirm(this.identity, answers);
      return deliveryId;
    } catch (error) {
      // Si la confirmación falló, permitimos reintentar si el borrador aún existe
      this.isConfirmed = false;
      throw error;
    }
  }

  /**
   * Destruye el controlador cancelando timers y descartando escrituras pendientes.
   */
  dispose(): void {
    this.isDisposed = true;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingPayload = null;
  }

  getStatus(): { isConfirmed: boolean; isDisposed: boolean; hasPending: boolean } {
    return {
      isConfirmed: this.isConfirmed,
      isDisposed: this.isDisposed,
      hasPending: this.pendingPayload !== null || this.debounceTimer !== null,
    };
  }
}
