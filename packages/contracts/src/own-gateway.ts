// Own, versioned addition. Generated upstream declarations remain unchanged.
import type * as Upstream from './generated-gateway.js';
type MedicationBinding = { medicamento_paciente_id?: string | null };
export type GatewayConfiguracionRecordatorio = Upstream.GatewayConfiguracionRecordatorio &
  MedicationBinding;
export type GatewayCrearRecordatorio = Upstream.GatewayCrearRecordatorio & MedicationBinding;
export type GatewayReemplazarRecordatorio = Upstream.GatewayReemplazarRecordatorio &
  MedicationBinding;
export type GatewayRecordatorio = Upstream.GatewayRecordatorio & MedicationBinding;
export type GatewayRecordatorioEnvelope = Omit<
  Upstream.GatewayRecordatorioEnvelope,
  'recordatorio'
> & { recordatorio: GatewayRecordatorio };
export type GatewayAgenda = Omit<Upstream.GatewayAgenda, 'recordatorios'> & {
  recordatorios: GatewayRecordatorio[];
};
