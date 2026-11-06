/* global window, document */
// Tokens only live in the Swagger instance/closure. Storage contains a short-lived PKCE transaction.

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function createPkcePair() {
  if (!window.isSecureContext) {
    throw new Error('Abre esta página mediante HTTPS o localhost para iniciar sesión.');
  }
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  return { verifier, state, challenge };
}

function buildAuthorizeUrl(config, callback, state, challenge) {
  const target = new URL(callback.href);
  target.searchParams.set('qc_state', state);
  const authorize = new URL(config.issuer + '/authorize');
  authorize.searchParams.set('provider', 'google');
  authorize.searchParams.set('redirect_to', target.href);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 's256');
  return authorize.href;
}

function isPendingSessionValid(pending) {
  if (!pending || typeof pending !== 'object') return false;
  if (typeof pending.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pending.verifier)) {
    return false;
  }
  if (typeof pending.createdAt !== 'number') return false;
  const now = Date.now();
  return now - pending.createdAt <= 600000 && pending.createdAt <= now;
}

function validateIncomingCallback(incoming, isCallback, pending) {
  if (
    !isCallback ||
    incoming.hash ||
    incoming.searchParams.has('error') ||
    !isPendingSessionValid(pending)
  ) {
    return false;
  }
  const codes = incoming.searchParams.getAll('code');
  const states = incoming.searchParams.getAll('qc_state');
  return (
    codes.length === 1 && states.length === 1 && states[0] === pending.state && Boolean(codes[0])
  );
}

async function exchangePkceToken(config, code, verifier) {
  const response = await fetch(config.issuer + '/token?grant_type=pkce', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
    headers: { apikey: config.publicKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      auth_code: code,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) {
    throw new Error(
      'No se pudo completar el acceso. Revisa el retorno permitido en Supabase y reintenta.',
    );
  }
  const session = await response.json();
  if (
    typeof session.access_token !== 'string' ||
    !session.access_token ||
    !Number.isFinite(session.expires_in) ||
    session.expires_in <= 0 ||
    session.expires_in > 86400
  ) {
    throw new Error('La sesión recibida no es válida. Reintenta el acceso.');
  }
  return session;
}

async function verifyOperatorAccess(config, accessToken) {
  const allowed = await fetch(
    config.root.replace(/\/docs\/preparacion\/$/, '') + '/admin/api/v1/preparacion/acceso',
    {
      headers: { authorization: 'Bearer ' + accessToken },
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
    },
  );
  if (allowed.status === 503) {
    throw new Error('El servicio de acceso no está disponible temporalmente. Inténtalo más tarde.');
  }
  if (allowed.status === 401) {
    throw new Error('La sesión no es válida o venció. Vuelve a entrar con Google.');
  }
  if (allowed.status === 403) {
    throw new Error(
      'Tu cuenta Google no está autorizada como operador. Solicita su autorización local una sola vez.',
    );
  }
  if (!allowed.ok || (await allowed.json()).autorizado !== true) {
    throw new Error('No se pudo verificar el permiso de operador. Reintenta.');
  }
}

async function executeCallbackFlow(config, incoming, isCallback, key) {
  const raw = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  const pending = raw ? JSON.parse(raw) : null;
  if (!validateIncomingCallback(incoming, isCallback, pending)) {
    throw new Error(
      'El retorno de Google no es válido o venció. Pulsa Entrar con Google otra vez.',
    );
  }
  const session = await exchangePkceToken(
    config,
    incoming.searchParams.get('code'),
    pending.verifier,
  );
  await verifyOperatorAccess(config, session.access_token);
  return {
    view: pending.view === 'contrato' ? 'contrato' : 'preparacion',
    token: session.access_token,
    expiresIn: session.expires_in,
  };
}

function setNavigationDisabled(navigation, disabled) {
  navigation.forEach(({ button }) => {
    button.disabled = disabled;
  });
}

function authorizeRequest(authState, request) {
  delete request.headers.Authorization;
  delete request.headers.authorization;
  if (!authState.active) {
    throw new Error('La sesión de Swagger está cerrada. Entra con Google.');
  }
  if (new URL(request.url, window.location.href).origin === window.location.origin) {
    request.headers.Authorization = 'Bearer ' + authState.token;
  }
  return request;
}

function clearSession(authState, uiElements, message = 'Sesión de Swagger cerrada.') {
  window.clearTimeout(authState.expiration);
  authState.active = false;
  authState.token = '';
  authState.revision++;
  if (authState.ui) {
    authState.ui.authActions.logout(['OperadorBearer', 'HTTPBearer']);
    authState.ui.specActions?.updateJsonSpec({});
    authState.ui = null;
  }
  uiElements.shell.hidden = true;
  uiElements.gate.hidden = false;
  uiElements.logout.hidden = true;
  uiElements.status.textContent = message;
}

async function openSwaggerDocument(createUi, authState, uiElements, selected) {
  if (!authState.active) return;
  const current = ++authState.revision;
  setNavigationDisabled(uiElements.navigation, true);
  try {
    const next = await createUi(authState.token, selected, (req) =>
      authorizeRequest(authState, req),
    );
    if (!authState.active || current !== authState.revision) {
      next.authActions.logout(['OperadorBearer', 'HTTPBearer']);
      next.specActions?.updateJsonSpec({});
      return;
    }
    if (authState.ui && authState.ui !== next) {
      authState.ui.authActions.logout(['OperadorBearer', 'HTTPBearer']);
    }
    authState.ui = next;
    const authScheme = selected === 'contrato' ? 'HTTPBearer' : 'OperadorBearer';
    authState.ui.preauthorizeApiKey(authScheme, authState.token);
    uiElements.gate.hidden = true;
    uiElements.shell.hidden = false;
    uiElements.logout.hidden = false;
    uiElements.status.textContent =
      'Operador autorizado. Ya puedes ejecutar los endpoints de esta página.';
  } catch (error) {
    if (current === authState.revision) {
      clearSession(
        authState,
        uiElements,
        error.message || 'No se pudo abrir Swagger. Reintenta el acceso.',
      );
    }
  } finally {
    setNavigationDisabled(uiElements.navigation, false);
  }
}

async function startGoogleLogin(config, callback, key, authState, uiElements) {
  uiElements.login.disabled = true;
  try {
    const { verifier, state: pkceState, challenge } = await createPkcePair();
    sessionStorage.setItem(
      key,
      JSON.stringify({ verifier, state: pkceState, createdAt: Date.now(), view: authState.view }),
    );
    const authorizeUrl = buildAuthorizeUrl(config, callback, pkceState, challenge);
    clearSession(authState, uiElements, 'Abriendo Google…');
    window.location.assign(authorizeUrl);
  } catch (error) {
    sessionStorage.removeItem(key);
    uiElements.status.textContent = error.message || 'No se pudo iniciar Google. Reintenta.';
    uiElements.login.disabled = false;
  }
}

async function processIncomingReturn(
  createUi,
  config,
  incoming,
  isCallback,
  key,
  authState,
  uiElements,
) {
  uiElements.login.disabled = true;
  uiElements.status.textContent = 'Comprobando acceso de operador…';
  try {
    const result = await executeCallbackFlow(config, incoming, isCallback, key);
    authState.view = result.view;
    authState.token = result.token;
    authState.active = true;
    authState.expiration = window.setTimeout(
      () => clearSession(authState, uiElements, 'La sesión venció. Vuelve a entrar con Google.'),
      result.expiresIn * 1000,
    );
    await openSwaggerDocument(createUi, authState, uiElements, authState.view);
  } catch (error) {
    clearSession(authState, uiElements, error.message || 'No se pudo iniciar sesión.');
  } finally {
    uiElements.login.disabled = false;
  }
}

window.initPreparationAuth = async function (createUi, config) {
  const uiElements = {
    login: document.getElementById('qc-login'),
    logout: document.getElementById('qc-logout'),
    status: document.getElementById('qc-access-status'),
    gate: document.getElementById('qc-login-gate'),
    shell: document.getElementById('qc-swagger-shell'),
    navigation: ['preparacion', 'contrato'].map((navView) => ({
      view: navView,
      button: document.getElementById('qc-document-' + navView),
    })),
  };

  const callback = new URL(config.root + 'oauth/callback', window.location.origin);
  const key = 'qc-preparation-pkce:' + config.root;
  const initialView =
    new URL(window.location.href).searchParams.get('vista') === 'contrato'
      ? 'contrato'
      : 'preparacion';

  const authState = {
    expiration: undefined,
    active: false,
    token: '',
    ui: null,
    revision: 0,
    view: initialView,
  };

  uiElements.navigation.forEach(({ view: navView, button }) => {
    button.onclick = () => openSwaggerDocument(createUi, authState, uiElements, navView);
  });
  uiElements.shell.hidden = true;
  uiElements.gate.hidden = false;

  window.addEventListener('pagehide', () => {
    if (authState.active) clearSession(authState, uiElements);
  });
  window.qcPreparationAuth = {
    expired: () =>
      clearSession(authState, uiElements, 'La sesión venció. Vuelve a entrar con Google.'),
  };
  uiElements.logout.onclick = () => {
    sessionStorage.removeItem(key);
    clearSession(authState, uiElements);
  };

  const incoming = new URL(window.location.href);
  const isCallback = incoming.pathname === callback.pathname;
  const hasReturn =
    isCallback ||
    incoming.searchParams.has('code') ||
    incoming.searchParams.has('error') ||
    Boolean(incoming.hash);

  // Remove codes/provider errors from history before making any network request.
  if (hasReturn) window.history.replaceState(null, '', config.root);

  if (!config.issuer || !config.publicKey) {
    uiElements.login.disabled = true;
    uiElements.status.textContent =
      'Google no está configurado para Swagger. El servidor requiere AUTH_PUBLIC_KEY pública y Supabase.';
    return;
  }

  uiElements.login.onclick = () => startGoogleLogin(config, callback, key, authState, uiElements);

  if (!hasReturn) {
    uiElements.status.textContent = 'Entra con Google para preparar datos y vincular pacientes.';
    return;
  }

  await processIncomingReturn(createUi, config, incoming, isCallback, key, authState, uiElements);
};
