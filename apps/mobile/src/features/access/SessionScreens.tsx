import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { router } from 'expo-router';
import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  DetailRow,
  InfoCard,
  SectionTitle,
  VisualButton,
  VisualField,
} from '../../components/Visual';
import { useOptionalLocalData } from '../../providers/LocalDataProvider';
import type { SessionSnapshot } from '../../services/session/http-session-types';
import { registerNativePush } from '../../services/session/native-session';
import type { GatewaySesion } from '@quimiocare/contracts';
const empty: SessionSnapshot = {
  state: 'unconfigured',
  user: null,
  identity: null,
  stale: true,
  consent: null,
  terms: null,
  uploadAllowed: false,
  message: null,
  revision: 0,
};
const noop = () => () => {};
const getEmpty = () => empty;
export function useIdentity() {
  const data = useOptionalLocalData(),
    session = data?.identitySession ?? null;
  const snapshot = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? getEmpty,
    getEmpty,
  );
  return { data, session, snapshot };
}
export function SessionNotice() {
  const { snapshot, data } = useIdentity();
  if (!snapshot.user || ['context_ready', 'closing', 'no_identity'].includes(snapshot.state))
    return null;
  return (
    <InfoCard>
      <BodyText>{snapshot.message ?? 'Comprobando la sesión…'}</BodyText>
      <VisualButton
        label="Revisar sesión"
        secondary
        onPress={() => router.navigate(data?.patientId ? '/perfil/sesion' : '/acceso')}
      />
    </InfoCard>
  );
}
export function IdentityScreen() {
  const { data, session, snapshot } = useIdentity(),
    [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState<string | null>(null);
  async function refresh() {
    if (!session || busy) return;
    setBusy(true);
    try {
      await session.refreshIdentity();
      setFeedback('Sesión y permisos actualizados.');
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'No se pudo actualizar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen title="Sesión y permisos">
      <DemoBadge />
      <InfoCard>
        <SectionTitle>{snapshot.user?.name ?? 'Sin sesión configurada'}</SectionTitle>
        <BodyText>{snapshot.message ?? 'Consulta y administra tu sesión.'}</BodyText>
        <DetailRow
          label="Estado"
          value={
            {
              context_ready: 'Sesión verificada',
              no_identity: 'Sin sesión',
              authenticating: 'Iniciando sesión',
              reauthenticating: 'Comprobando sesión',
              renewing: 'Renovando sesión',
              expired: 'Requiere autenticarte nuevamente',
              access_denied: 'Acceso no autorizado',
              unconfigured: 'Servicio no configurado',
              closing: 'Cerrando sesión',
              profile_incomplete: 'Datos personales pendientes',
              terms_pending: 'Términos pendientes',
              clinical_incomplete: 'Contexto clínico incompleto',
              service_unavailable: 'Servicio no disponible',
              preparing_storage: 'Preparando almacenamiento',
              demo_selection: 'Seleccionando cuenta',
            }[snapshot.state]
          }
        />
        <DetailRow
          label="Datos de perfil"
          value={snapshot.stale ? 'Copia anterior · pendiente de verificar' : 'Verificados online'}
        />
        <DetailRow
          label="Envíos clínicos"
          value={
            snapshot.uploadAllowed
              ? 'Consentimiento confirmado'
              : 'Pausados · capturas locales conservadas'
          }
        />
        {snapshot.identity ? (
          <DetailRow label="Última consulta" value={snapshot.identity.fetchedAt} />
        ) : null}
      </InfoCard>
      {feedback ? <BodyText>{feedback}</BodyText> : null}
      <VisualButton
        label="Actualizar sesión y permisos"
        disabled={!session || busy}
        onPress={() => void refresh()}
      />
      {snapshot.state === 'expired' ? (
        <VisualButton
          label="Volver a autenticarme"
          onPress={() => {
            if (session?.config.mode === 'demo') router.navigate('/acceso/seleccionar-paciente');
            else
              void data?.manager
                .authenticate()
                .catch((e) => setFeedback(e instanceof Error ? e.message : 'No se pudo acceder.'));
          }}
        />
      ) : null}
      {snapshot.state === 'profile_incomplete' ? (
        <VisualButton
          label="Completar mis datos"
          onPress={() => router.navigate('/perfil/completar')}
        />
      ) : null}
      <VisualButton
        label="Revisar consentimiento"
        secondary
        onPress={() => router.navigate('/perfil/consentimientos')}
      />
      <VisualButton
        label="Mis dispositivos"
        secondary
        onPress={() => router.navigate('/perfil/dispositivos')}
      />
    </Screen>
  );
}
export function OnlineConsentScreen() {
  const { session, snapshot } = useIdentity(),
    [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      if (session.getCurrentUser()) await session.refreshConsent();
      else await session.publicTerms();
      setFeedback(null);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'No se pudo consultar el consentimiento.');
    } finally {
      setBusy(false);
    }
  }, [session]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function accept() {
    if (!session || busy) return;
    setBusy(true);
    try {
      await session.acceptTerms();
      const identity = session.getSnapshot().identity;
      setFeedback(
        identity?.clinicalStatus === 'missing' || identity?.treatmentStatus === 'missing'
          ? 'Aceptación confirmada por el servidor. Falta la vinculación clínica: solicita tu código desde Perfil.'
          : 'Aceptación confirmada por el servidor.',
      );
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'No se pudo confirmar la aceptación.');
    } finally {
      setBusy(false);
    }
  }
  const term = snapshot.terms,
    current = snapshot.consent?.consentimiento_actual;
  return (
    <Screen title="Consentimientos">
      <DemoBadge />
      <BodyText>
        {session?.config.mode === 'demo'
          ? 'Demostración con cuentas compartidas: usa solo datos ficticios. Esta aceptación no acredita atención médica ni aprobación institucional.'
          : 'Revisa los términos vigentes y su estado confirmado por el servidor.'}
      </BodyText>
      {feedback ? (
        <InfoCard>
          <BodyText>{feedback}</BodyText>
        </InfoCard>
      ) : null}
      {!session ? (
        <InfoCard>
          <BodyText>
            El servicio de términos no está configurado. Una aceptación local no habilita envíos.
          </BodyText>
        </InfoCard>
      ) : null}
      {term ? (
        <InfoCard>
          <SectionTitle>{term.titulo}</SectionTitle>
          <DetailRow label="Versión" value={term.version} />
          <DetailRow label="Vigente desde" value={term.vigente_desde} />
          <BodyText>{term.texto_completo}</BodyText>
        </InfoCard>
      ) : (
        <BodyText>
          {busy ? 'Consultando términos…' : 'Sin términos verificados disponibles.'}
        </BodyText>
      )}
      <InfoCard>
        <BodyText>
          {snapshot.uploadAllowed
            ? 'Consentimiento vigente confirmado.'
            : current?.revocado
              ? 'El acto anterior está revocado. Se requiere una aceptación nueva.'
              : 'Los envíos siguen pausados hasta confirmar el consentimiento vigente online.'}
        </BodyText>
        {current ? <DetailRow label="Aceptado el" value={current.otorgado_el} /> : null}
        <BodyText>
          Sin conexión puedes conservar capturas y consultar tu historia. Para confirmar una
          aceptación necesitas conexión. Para retirar tu autorización, utiliza los contactos
          indicados en los términos.
        </BodyText>
      </InfoCard>
      {term && snapshot.user && !snapshot.uploadAllowed ? (
        <VisualButton
          label="Acepto y autorizo el tratamiento de mis datos"
          disabled={busy || snapshot.stale}
          onPress={() => void accept()}
        />
      ) : null}
      <VisualButton
        label="Actualizar términos y estado"
        secondary
        disabled={!session || busy}
        onPress={() => void refresh()}
      />
    </Screen>
  );
}
export function CompleteProfileScreen() {
  const { session } = useIdentity(),
    [rut, setRut] = useState(''),
    [phone, setPhone] = useState(''),
    [birth, setBirth] = useState(''),
    [sex, setSex] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null);
  async function save() {
    if (!session || busy) return;
    setBusy(true);
    try {
      await session.completeProfile({
        rut,
        telefono: phone || null,
        fecha_nacimiento: birth || null,
        sexo: sex || null,
      });
      setMessage('Datos confirmados por el servidor.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudieron guardar los datos.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen title="Completar mis datos">
      <BodyText>La identidad de tu cuenta proviene del inicio de sesión.</BodyText>
      <VisualField label="RUT" value={rut} onChangeText={setRut} />
      <VisualField
        label="Teléfono"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <VisualField label="Fecha de nacimiento (AAAA-MM-DD)" value={birth} onChangeText={setBirth} />
      <VisualField label="Sexo" value={sex} onChangeText={setSex} />
      {message ? <BodyText>{message}</BodyText> : null}
      <VisualButton
        label="Guardar datos online"
        disabled={!session || busy || !rut.trim()}
        onPress={() => void save()}
      />
    </Screen>
  );
}
export function DevicesScreen() {
  const { data, session } = useIdentity(),
    [items, setItems] = useState<GatewaySesion[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null),
    [pending, setPending] = useState(0);
  const load = useCallback(async () => {
    if (!data?.devices) return;
    setBusy(true);
    try {
      const page = await data.devices.list();
      setItems(page.items);
      setCursor(page.next_cursor);
      setPending(await data.devices.pendingCount());
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudieron consultar los dispositivos.');
    } finally {
      setBusy(false);
    }
  }, [data?.devices]);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(work: () => Promise<unknown>, reload = true) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      if (reload) await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'La operación no se pudo confirmar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen title="Mis dispositivos">
      <BodyText>
        Una asociación habilita notificaciones push. Revocarla no cierra la sesión central ni
        cancela de inmediato los avisos de otro teléfono sin conexión.
      </BodyText>
      {message ? (
        <InfoCard>
          <BodyText>{message}</BodyText>
        </InfoCard>
      ) : null}
      {pending ? (
        <BodyText>
          Hay {pending} revocaciones pendientes de esta cuenta. No se han confirmado en el servidor.
        </BodyText>
      ) : null}
      <VisualButton
        label="Registrar este teléfono para push"
        disabled={!data?.devices || busy}
        onPress={() => void act(() => registerNativePush(data!.devices!))}
      />
      <VisualButton
        label="Actualizar dispositivos"
        secondary
        disabled={!session || busy}
        onPress={() => void load()}
      />
      {pending ? (
        <VisualButton
          label="Reintentar mis revocaciones pendientes"
          disabled={busy}
          onPress={() => void act(() => data!.devices!.reconcilePending())}
        />
      ) : null}
      {items.map((item) => (
        <InfoCard key={item.id}>
          <SectionTitle>{item.activa ? 'Asociación activa' : 'Asociación revocada'}</SectionTitle>
          <DetailRow label="Creada" value={item.creado_en} />
          <DetailRow label="Última conexión" value={item.ultima_conexion} />
          <DetailRow label="Token habilitado" value={item.token_registrado ? 'Sí' : 'No'} />
          {item.activa ? (
            <VisualButton
              label="Revocar esta asociación"
              secondary
              disabled={busy}
              onPress={() => void act(() => data!.devices!.revoke(item.id))}
            />
          ) : null}
        </InfoCard>
      ))}
      {cursor ? (
        <VisualButton
          label="Ver más dispositivos"
          disabled={busy}
          onPress={() =>
            void act(async () => {
              const page = await data!.devices!.list(cursor);
              setItems((old) => [...old, ...page.items]);
              setCursor(page.next_cursor);
            }, false)
          }
        />
      ) : null}
    </Screen>
  );
}
