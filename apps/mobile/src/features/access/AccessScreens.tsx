import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  DetailRow,
  EmptyState,
  InfoCard,
  ProgressBar,
  SectionTitle,
  StatusPill,
  VisualButton,
  VisualField,
} from '../../components/Visual';
import { listCachedTerms } from '../../data/local/consents/consent-repository';
import type {
  ConsentStatusInfo,
  TermDefinitionRecord,
} from '../../data/local/consents/consent-types';
import { formatDate } from '../../data/local/repository';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';
import { isDemoMode } from '../../utils/environment';

function AccessIntro({ subtitle }: { subtitle: string }) {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  return (
    <View style={styles.intro}>
      <Text style={styles.logo}>Q</Text>
      <Text style={styles.brand}>QuimioCare</Text>
      <BodyText>{subtitle}</BodyText>
    </View>
  );
}

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <Screen backTo="/">
      <AccessIntro subtitle="Acompañamiento durante tu quimioterapia." />
      <DemoBadge />
      <InfoCard>
        <SectionTitle>Servicios de acceso</SectionTitle>
        <BodyText>
          Los servicios centrales de autenticación no están configurados en esta entrega. Para
          evaluar el módulo móvil de forma independiente, puedes seleccionar una identidad de prueba
          local.
        </BodyText>
      </InfoCard>
      {isDemoMode() ? (
        <VisualButton
          label="Seleccionar paciente de prueba"
          onPress={() => router.navigate('/acceso/seleccionar-paciente')}
        />
      ) : null}
      <VisualField
        label="Correo electrónico (deshabilitado · sin servicio central)"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        placeholder="Autenticación central no configurada"
        editable={false}
      />
      <VisualField
        label="Contraseña (deshabilitado · sin servicio central)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Autenticación central no configurada"
        editable={false}
      />
      <VisualButton label="Iniciar sesión · No configurado" disabled />
      <VisualButton
        label="¿Olvidaste tu contraseña?"
        secondary
        onPress={() => router.navigate('/acceso/recuperar')}
      />
      <VisualButton
        label="Crear cuenta nueva"
        secondary
        onPress={() => router.navigate('/acceso/registro')}
      />
      <VisualButton
        label="Ver términos y consentimientos"
        secondary
        onPress={() => router.navigate('/acceso/consentimientos')}
      />
    </Screen>
  );
}

export function RegisterScreen() {
  const [values, setValues] = useState({ name: '', surname: '', email: '', password: '' });
  return (
    <Screen title="Crear cuenta" backTo="/acceso">
      <DemoBadge />
      <InfoCard>
        <SectionTitle>Registro de usuarios</SectionTitle>
        <BodyText>
          El registro de cuentas centrales no está configurado en este entorno. Puedes revisar los
          términos y consentimientos disponibles o seleccionar un paciente de prueba en modo
          demostración.
        </BodyText>
      </InfoCard>
      {isDemoMode() ? (
        <VisualButton
          label="Seleccionar paciente de prueba"
          onPress={() => router.navigate('/acceso/seleccionar-paciente')}
        />
      ) : null}
      <VisualField
        label="Nombre (deshabilitado · sin servicio central)"
        value={values.name}
        onChangeText={(name) => setValues({ ...values, name })}
        placeholder="No configurado"
        editable={false}
      />
      <VisualField
        label="Apellido (deshabilitado · sin servicio central)"
        value={values.surname}
        onChangeText={(surname) => setValues({ ...values, surname })}
        placeholder="No configurado"
        editable={false}
      />
      <VisualField
        label="Correo electrónico (deshabilitado · sin servicio central)"
        value={values.email}
        onChangeText={(email) => setValues({ ...values, email })}
        keyboardType="email-address"
        placeholder="No configurado"
        editable={false}
      />
      <VisualField
        label="Contraseña (deshabilitado · sin servicio central)"
        value={values.password}
        onChangeText={(password) => setValues({ ...values, password })}
        secureTextEntry
        placeholder="No configurado"
        editable={false}
      />
      <VisualButton
        label="Ver consentimientos"
        onPress={() => router.navigate('/acceso/consentimientos')}
      />
      <VisualButton label="Registrarse · No configurado" secondary disabled />
    </Screen>
  );
}

type TermWithEvaluation = {
  term: TermDefinitionRecord;
  status: ConsentStatusInfo | null;
  validity: {
    isValid: boolean;
    isFuture: boolean;
    isExpired: boolean;
  };
};

function evaluateTermValidity(term: TermDefinitionRecord) {
  const now = Date.now();
  const desde = Date.parse(term.vigente_desde);
  const hasta = term.vigente_hasta ? Date.parse(term.vigente_hasta) : null;
  const isFuture = !isNaN(desde) && now < desde;
  const isExpired = hasta !== null && !isNaN(hasta) && now > hasta;
  return {
    isValid: !isFuture && !isExpired,
    isFuture,
    isExpired,
  };
}

export function AccessConsentScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { database, repository, patientId, runSave, saving } = useLocalData();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadData = useCallback(async (): Promise<TermWithEvaluation[]> => {
    if (!database) return [];
    const terms = await listCachedTerms(database);
    const result: TermWithEvaluation[] = [];
    for (const term of terms) {
      let status: ConsentStatusInfo | null = null;
      if (repository && patientId) {
        status = await repository.getConsentStatus(term.termino_id, term.version);
      }
      result.push({
        term,
        status,
        validity: evaluateTermValidity(term),
      });
    }
    return result;
  }, [database, repository, patientId]);

  const {
    value: termsData,
    loading,
    error,
    refresh,
  } = useFocusedValue(loadData, [] as TermWithEvaluation[]);

  async function handleGrant(terminoId: string, version: string) {
    if (busy || saving || !repository || !patientId) return;
    setBusy(true);
    setFeedback(null);
    try {
      await runSave(async () => {
        await repository.grantConsent(terminoId, version);
      });
      setFeedback('Consentimiento otorgado y registrado en este dispositivo.');
      await refresh();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Error al registrar el consentimiento.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(consentId: string) {
    if (busy || saving || !repository || !patientId) return;
    setBusy(true);
    setFeedback(null);
    try {
      await runSave(async () => {
        await repository.revokeConsent(consentId);
      });
      setFeedback('Consentimiento revocado y registrado en este dispositivo.');
      await refresh();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Error al revocar el consentimiento.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Consentimientos" backTo="/acceso/registro">
      <DemoBadge />
      <BodyText>
        Revisión y gestión de consentimientos informados y términos versionados de QuimioCare. El
        contenido actual corresponde a muestras técnicas demostrativas con trazabilidad en el
        almacenamiento local.
      </BodyText>

      {feedback ? (
        <InfoCard>
          <Text style={styles.feedbackText}>{feedback}</Text>
        </InfoCard>
      ) : null}

      {loading ? (
        <InfoCard>
          <BodyText>Consultando términos y consentimientos…</BodyText>
        </InfoCard>
      ) : error ? (
        <InfoCard>
          <BodyText>No se pudo consultar el registro de consentimientos.</BodyText>
          <VisualButton label="Reintentar" onPress={refresh} />
        </InfoCard>
      ) : !termsData || termsData.length === 0 ? (
        <EmptyState
          icon="file-text"
          title="No hay definiciones de términos registradas"
          description="El almacenamiento local no contiene términos ni consentimientos configurados para consulta."
        />
      ) : (
        termsData.map(({ term, status, validity }) => (
          <InfoCard key={`${term.termino_id}-${term.version}`}>
            <View style={styles.termHeader}>
              <SectionTitle>{term.titulo}</SectionTitle>
              <StatusPill>Muestra técnica demostrativa</StatusPill>
            </View>
            <DetailRow label="Identificador" value={term.termino_id} />
            <DetailRow label="Versión" value={`v${term.version}`} />
            <DetailRow label="Vigente desde" value={formatDate(term.vigente_desde)} />
            {term.vigente_hasta ? (
              <DetailRow label="Vigente hasta" value={formatDate(term.vigente_hasta)} />
            ) : null}

            {validity.isFuture ? (
              <StatusPill variant="danger">
                Vigencia futura · No disponible para aceptación
              </StatusPill>
            ) : validity.isExpired ? (
              <StatusPill variant="danger">Versión no vigente · Aceptación cerrada</StatusPill>
            ) : null}

            <View style={styles.contentBox}>
              <Text style={styles.contentText}>{term.contenido_markdown}</Text>
            </View>

            <View style={styles.statusRow}>
              {!patientId ? (
                <>
                  <StatusPill>Requiere sesión activa</StatusPill>
                  <BodyText style={styles.hintText}>
                    Para otorgar o revocar consentimientos debes iniciar sesión o seleccionar un
                    paciente de prueba.
                  </BodyText>
                  {isDemoMode() ? (
                    <VisualButton
                      label="Seleccionar paciente de prueba"
                      secondary
                      onPress={() => router.navigate('/acceso/seleccionar-paciente')}
                    />
                  ) : null}
                </>
              ) : status?.estado === 'otorgado' ? (
                <>
                  <StatusPill>
                    Consentimiento otorgado el{' '}
                    {formatDate(status.activeConsent!.fecha_otorgamiento)}
                  </StatusPill>
                  <StatusPill>Guardado en este dispositivo · Pendiente de envío</StatusPill>
                  <VisualButton
                    label="Revocar consentimiento"
                    secondary
                    onPress={() => handleRevoke(status.activeConsent!.id)}
                    disabled={busy || saving}
                  />
                </>
              ) : status?.estado === 'revocado' ? (
                <>
                  <StatusPill>
                    Consentimiento revocado el {formatDate(status.lastConsent!.fecha_revocacion!)}
                  </StatusPill>
                  <StatusPill>Guardado en este dispositivo · Pendiente de envío</StatusPill>
                  {validity.isValid ? (
                    <VisualButton
                      label="Aceptar consentimiento nuevamente"
                      onPress={() => handleGrant(term.termino_id, term.version)}
                      disabled={busy || saving}
                    />
                  ) : (
                    <VisualButton label="Aceptar consentimiento" disabled />
                  )}
                </>
              ) : (
                <>
                  <StatusPill>No otorgado</StatusPill>
                  {validity.isValid ? (
                    <VisualButton
                      label="Aceptar consentimiento"
                      onPress={() => handleGrant(term.termino_id, term.version)}
                      disabled={busy || saving}
                    />
                  ) : (
                    <VisualButton label="Aceptar consentimiento (no vigente)" disabled />
                  )}
                </>
              )}
            </View>
          </InfoCard>
        ))
      )}
    </Screen>
  );
}

export function RecoverScreen() {
  const [email, setEmail] = useState('');
  return (
    <Screen title="Olvidé mi contraseña" backTo="/acceso">
      <DemoBadge />
      <ProgressBar progress={33} />
      <BodyText>Paso 1 de 3 · Ingresa tu correo</BodyText>
      <InfoCard>
        <BodyText>
          La recuperación remota de contraseña no está conectada en esta versión local.
        </BodyText>
      </InfoCard>
      <VisualField
        label="Correo electrónico (deshabilitado · sin servicio central)"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        placeholder="No configurado"
        editable={false}
      />
      <VisualButton label="Enviar enlace · No configurado" disabled />
      <VisualButton
        label="Ver estado de correo enviado"
        secondary
        onPress={() => router.navigate('/acceso/correo')}
      />
    </Screen>
  );
}

export function MailSentScreen() {
  return (
    <Screen title="Revisa tu correo" backTo="/acceso/recuperar">
      <DemoBadge />
      <ProgressBar progress={66} />
      <BodyText>Paso 2 de 3 · Vista de ejemplo</BodyText>
      <InfoCard>
        <BodyText>
          Cuando el flujo de identidad esté conectado, aquí se explicará cómo usar el enlace
          recibido.
        </BodyText>
      </InfoCard>
      <VisualButton label="Reenviar correo · No configurado" disabled />
      <VisualButton
        label="Ver nueva contraseña"
        secondary
        onPress={() => router.navigate('/acceso/nueva-clave')}
      />
    </Screen>
  );
}

export function NewPasswordScreen() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  return (
    <Screen title="Nueva contraseña" backTo="/acceso/correo">
      <DemoBadge />
      <ProgressBar progress={100} />
      <BodyText>Paso 3 de 3 · Vista de ejemplo</BodyText>
      <InfoCard>
        <BodyText>
          La validación y actualización de la contraseña se incorporarán con autenticación central.
        </BodyText>
      </InfoCard>
      <VisualField
        label="Nueva contraseña (deshabilitado · sin servicio central)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="No configurado"
        editable={false}
      />
      <VisualField
        label="Confirmar contraseña (deshabilitado · sin servicio central)"
        value={confirmation}
        onChangeText={setConfirmation}
        secureTextEntry
        placeholder="No configurado"
        editable={false}
      />
      <VisualButton label="Actualizar contraseña · No configurado" disabled />
    </Screen>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    intro: { alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.lg },
    logo: {
      width: 72,
      height: 72,
      overflow: 'hidden',
      borderRadius: 18,
      backgroundColor: colors.primaryContainer,
      textAlign: 'center',
      textAlignVertical: 'center',
      fontSize: 34,
      fontWeight: '700',
      color: colors.primary,
    },
    brand: { fontSize: 28, fontWeight: '700', color: colors.primary },
    termHeader: {
      gap: theme.spacing.xs,
      marginBottom: theme.spacing.xs,
    },
    contentBox: {
      backgroundColor: colors.surface,
      padding: theme.spacing.md,
      borderRadius: theme.radius.sm,
      marginVertical: theme.spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    contentText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.text,
    },
    statusRow: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
    },
    hintText: {
      fontSize: 13,
      color: colors.secondary,
      marginVertical: 4,
    },
    feedbackText: {
      color: colors.primary,
      fontWeight: '600',
    },
  });
}
