import { View } from 'react-native';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { router } from 'expo-router';
import { cleanRut, formatRut, validateRut } from '../../utils/rut-chileno';
import { Screen } from '../../components/Screen';
import { DateTimePickerField } from '../../components/DateTimePickerField';
import { MascotHero } from '../../components/MascotAvatar';
import {
  BodyText,
  DemoBadge,
  ChoiceChip,
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
        onPress={() => router.push(data?.patientId ? '/perfil/sesion' : '/acceso')}
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
    <Screen mascotPose="explicacion" title="Sesión y permisos">
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
          value={
            snapshot.stale ? 'Copia anterior · pendiente de verificar' : 'Información actualizada'
          }
        />
        <DetailRow
          label="Envíos clínicos"
          value={
            snapshot.uploadAllowed
              ? 'Consentimiento confirmado'
              : 'Pausados · registros guardados en este teléfono'
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
            if (session?.config.mode === 'demo') router.push('/acceso/seleccionar-paciente');
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
          onPress={() => router.push('/perfil/completar')}
        />
      ) : null}
      <VisualButton
        label="Revisar consentimiento"
        secondary
        onPress={() => router.push('/perfil/consentimientos')}
      />
      <VisualButton
        label="Mis dispositivos"
        secondary
        onPress={() => router.push('/perfil/dispositivos')}
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
          ? 'Tu aceptación quedó confirmada. Falta la vinculación clínica: solicita tu código desde Perfil.'
          : 'Tu aceptación quedó confirmada.',
      );
      router.replace?.('/(tabs)');
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'No se pudo confirmar la aceptación.');
    } finally {
      setBusy(false);
    }
  }
  const term = snapshot.terms,
    current = snapshot.consent?.consentimiento_actual;
  return (
    <Screen mascotPose="lectura" title="Consentimientos">
      <DemoBadge />
      <BodyText>
        {session?.config.mode === 'demo'
          ? 'Demostración con cuentas compartidas: usa solo datos ficticios. Esta aceptación no acredita atención médica ni aprobación institucional.'
          : 'Revisa los términos vigentes y si tu aceptación está confirmada.'}
      </BodyText>
      {feedback ? (
        <InfoCard>
          <BodyText>{feedback}</BodyText>
        </InfoCard>
      ) : null}
      {!session ? (
        <InfoCard>
          <BodyText>
            No podemos consultar los términos ahora. Necesitas revisarlos y confirmar tu aceptación
            antes de enviar registros.
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
              : 'Los envíos siguen pausados hasta confirmar tu aceptación de los términos vigentes. Necesitas conexión para hacerlo.'}
        </BodyText>
        {current ? <DetailRow label="Aceptado el" value={current.otorgado_el} /> : null}
        <BodyText>
          Necesitas internet para aceptar. Tus registros guardados siguen disponibles sin conexión.
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
  const { session, snapshot } = useIdentity(),
    localData = useOptionalLocalData(),
    [rut, setRut] = useState(''),
    [phone, setPhone] = useState(''),
    [birth, setBirth] = useState(''),
    [sex, setSex] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [message, setMessage] = useState<string | null>(null);

  const existingProfile = snapshot.identity?.profile;

  useEffect(() => {
    if (!dirty && existingProfile) {
      if (existingProfile.rut) {
        setRut(formatRut(existingProfile.rut));
      }
      if (existingProfile.telefono) {
        const cleanDigits = existingProfile.telefono.replace(/^\+?569?/, '').replace(/\D/g, '');
        setPhone(cleanDigits.slice(0, 8));
      }
      if (existingProfile.fecha_nacimiento) {
        setBirth(existingProfile.fecha_nacimiento);
      }
      if (existingProfile.sexo) {
        setSex(existingProfile.sexo);
      }
    }
  }, [existingProfile, dirty]);

  const handleRutChange = (text: string) => {
    setDirty(true);
    setRut(formatRut(text));
    if (message) setMessage(null);
  };

  const handlePhoneChange = (text: string) => {
    setDirty(true);
    const digits = text.replace(/\D/g, '').slice(0, 8);
    setPhone(digits);
    if (message) setMessage(null);
  };

  const isRutValid = validateRut(rut);
  const showRutError = rut.length >= 8 && !isRutValid;

  async function save() {
    if (!session || busy) return;
    if (!validateRut(rut)) {
      setMessage('El RUT ingresado no es válido. Revisa los dígitos y el cálculo verificador.');
      return;
    }
    setBusy(true);
    try {
      const canonicalPhone = phone.trim() ? `+569${phone.trim()}` : null;
      const cleanedRut = cleanRut(rut);
      await session.completeProfile({
        rut: cleanedRut,
        telefono: canonicalPhone,
        fecha_nacimiento: birth || null,
        sexo: sex || null,
      });
      if (localData?.repository) {
        try {
          await localData.repository.saveProfile({
            nombre: existingProfile?.nombre || session.getCurrentUser()?.name || 'Paciente',
            email: existingProfile?.email ?? null,
            rut: cleanedRut,
          });
        } catch {
          // ignore cache persistence fallback
        }
      }
      setMessage('Tus datos quedaron confirmados.');
      const consentRequired = Boolean(session.getSnapshot().consent?.requiere_aceptacion);
      if (consentRequired) {
        router.replace('/acceso/consentimientos');
      } else {
        router.replace('/(tabs)');
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudieron guardar los datos.');
    } finally {
      setBusy(false);
    }
  }

  const SEX_OPTIONS = ['Femenino', 'Masculino', 'Prefiero no informar'] as const;

  return (
    <Screen>
      <MascotHero
        pose="apoyo"
        eyebrow="TU PERFIL"
        title="Datos personales"
        description="Completa o actualiza tus datos de contacto y antecedentes demográficos."
        compact
      />
      {snapshot.identity?.profile ? (
        <InfoCard>
          <DetailRow
            label="Nombre"
            value={
              snapshot.identity.profile.nombre ?? snapshot.user?.name ?? 'Sin nombre informado'
            }
          />
          <DetailRow label="Correo" value={snapshot.identity.profile.email} />
        </InfoCard>
      ) : snapshot.user?.name ? (
        <BodyText>{snapshot.user.name}</BodyText>
      ) : null}

      <VisualField
        label="RUT"
        value={rut}
        onChangeText={handleRutChange}
        keyboardType="default"
        placeholder="Ej.: 12.345.678-9"
        helperText="Formato automático con puntos y guion. Valida dígito verificador chileno."
        errorText={showRutError ? 'RUT no válido según cálculo de dígito verificador.' : undefined}
      />

      <VisualField
        label="Teléfono de contacto (+56 9)"
        value={phone}
        onChangeText={handlePhoneChange}
        keyboardType="phone-pad"
        maxLength={8}
        placeholder="Ej.: 87654321"
        helperText="Asume prefijo nacional (+56 9). Ingresa solo los 8 dígitos restantes."
      />

      <DateTimePickerField
        mode="date"
        label="Fecha de nacimiento"
        value={birth || null}
        maximumDate={new Date().toLocaleDateString('en-CA')}
        onChange={(val) => {
          setDirty(true);
          setBirth(val);
        }}
        disabled={busy}
      />

      <SectionTitle>Sexo</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {SEX_OPTIONS.map((option) => (
          <ChoiceChip
            key={option}
            label={option}
            selected={sex === option}
            disabled={busy}
            onPress={() => {
              setDirty(true);
              setSex(option);
            }}
          />
        ))}
      </View>

      {message ? (
        <BodyText style={{ color: isRutValid ? undefined : '#d32f2f' }}>{message}</BodyText>
      ) : null}

      <VisualButton
        label="Guardar y continuar"
        disabled={!session || busy || !isRutValid}
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
    <Screen mascotPose="explicacion" title="Mis dispositivos">
      <BodyText>
        Quitar un teléfono desactiva sus próximos avisos cuando vuelva a conectarse. No cierra su
        sesión.
      </BodyText>
      {message ? (
        <InfoCard>
          <BodyText>{message}</BodyText>
        </InfoCard>
      ) : null}
      {pending ? (
        <BodyText>
          Hay {pending} revocaciones pendientes de esta cuenta. Todavía no se han confirmado.
        </BodyText>
      ) : null}
      <VisualButton
        label="Registrar este teléfono para push"
        disabled={!data?.devices || busy}
        onPress={() => void act(() => registerNativePush(data!.devices!, { userInitiated: true }))}
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
