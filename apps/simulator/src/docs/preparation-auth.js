/* global window, document */
// Tokens only live in the Swagger instance/closure. Storage contains a short-lived PKCE transaction.
window.initPreparationAuth = async function (createUi, config) {
  const login = document.getElementById('qc-login');
  const logout = document.getElementById('qc-logout');
  const status = document.getElementById('qc-access-status');
  const gate = document.getElementById('qc-login-gate');
  const shell = document.getElementById('qc-swagger-shell');
  const navigation = ['preparacion', 'contrato'].map((view) => ({
    view,
    button: document.getElementById('qc-document-' + view),
  }));
  const callback = new URL(config.root + 'oauth/callback', window.location.origin);
  const key = 'qc-preparation-pkce:' + config.root;
  let expiration;
  let active = false;
  let token = '';
  let ui = null;
  let revision = 0;
  let view =
    new URL(window.location.href).searchParams.get('vista') === 'contrato'
      ? 'contrato'
      : 'preparacion';
  const say = (message) => {
    status.textContent = message;
  };
  const authorizeRequest = (request) => {
    delete request.headers.Authorization;
    delete request.headers.authorization;
    if (!active) throw new Error('La sesión de Swagger está cerrada. Entra con Google.');
    if (new URL(request.url, window.location.href).origin === window.location.origin)
      request.headers.Authorization = 'Bearer ' + token;
    return request;
  };
  const clear = (message = 'Sesión de Swagger cerrada.') => {
    window.clearTimeout(expiration);
    active = false;
    token = '';
    revision++;
    if (ui) {
      ui.authActions.logout(['OperadorBearer', 'HTTPBearer']);
      ui.specActions?.updateJsonSpec({});
      ui = null;
    }
    shell.hidden = true;
    gate.hidden = false;
    logout.hidden = true;
    say(message);
  };
  async function openDocument(selected) {
    if (!active) return;
    const current = ++revision;
    navigation.forEach(({ button }) => {
      button.disabled = true;
    });
    try {
      const next = await createUi(token, selected, authorizeRequest);
      if (!active || current !== revision) {
        next.authActions.logout(['OperadorBearer', 'HTTPBearer']);
        next.specActions?.updateJsonSpec({});
        return;
      }
      if (ui && ui !== next) ui.authActions.logout(['OperadorBearer', 'HTTPBearer']);
      ui = next;
      ui.preauthorizeApiKey(selected === 'contrato' ? 'HTTPBearer' : 'OperadorBearer', token);
      gate.hidden = true;
      shell.hidden = false;
      logout.hidden = false;
      say('Operador autorizado. Ya puedes ejecutar los endpoints de esta página.');
    } catch (error) {
      if (current === revision)
        clear(error.message || 'No se pudo abrir Swagger. Reintenta el acceso.');
    } finally {
      navigation.forEach(({ button }) => {
        button.disabled = false;
      });
    }
  }
  navigation.forEach(({ view, button }) => {
    button.onclick = () => openDocument(view);
  });
  shell.hidden = true;
  gate.hidden = false;
  window.addEventListener('pagehide', () => {
    if (active) clear();
  });
  window.qcPreparationAuth = {
    expired: () => clear('La sesión venció. Vuelve a entrar con Google.'),
  };
  logout.onclick = () => {
    sessionStorage.removeItem(key);
    clear();
  };
  const incoming = new URL(window.location.href);
  const isCallback = incoming.pathname === callback.pathname;
  const hasReturn =
    isCallback ||
    incoming.searchParams.has('code') ||
    incoming.searchParams.has('error') ||
    !!incoming.hash;
  // Remove codes/provider errors from history before making any network request.
  if (hasReturn) window.history.replaceState(null, '', config.root);
  if (!config.issuer || !config.publicKey) {
    login.disabled = true;
    say(
      'Google no está configurado para Swagger. El servidor requiere AUTH_PUBLIC_KEY pública y Supabase.',
    );
    return;
  }
  const base64url = (bytes) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  login.onclick = async () => {
    login.disabled = true;
    try {
      if (!window.isSecureContext)
        throw new Error('Abre esta página mediante HTTPS o localhost para iniciar sesión.');
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = base64url(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
      );
      sessionStorage.setItem(key, JSON.stringify({ verifier, state, createdAt: Date.now(), view }));
      const target = new URL(callback.href);
      target.searchParams.set('qc_state', state);
      const authorize = new URL(config.issuer + '/authorize');
      authorize.searchParams.set('provider', 'google');
      authorize.searchParams.set('redirect_to', target.href);
      authorize.searchParams.set('code_challenge', challenge);
      authorize.searchParams.set('code_challenge_method', 's256');
      clear('Abriendo Google…');
      window.location.assign(authorize.href);
    } catch (error) {
      sessionStorage.removeItem(key);
      say(error.message || 'No se pudo iniciar Google. Reintenta.');
      login.disabled = false;
    }
  };
  if (!hasReturn) {
    say('Entra con Google para preparar datos y vincular pacientes.');
    return;
  }
  login.disabled = true;
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    const pending = raw ? JSON.parse(raw) : null;
    if (
      !isCallback ||
      incoming.hash ||
      incoming.searchParams.has('error') ||
      !pending ||
      incoming.searchParams.getAll('code').length !== 1 ||
      incoming.searchParams.getAll('qc_state').length !== 1 ||
      incoming.searchParams.get('qc_state') !== pending.state ||
      typeof pending.verifier !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(pending.verifier) ||
      typeof pending.createdAt !== 'number' ||
      Date.now() - pending.createdAt > 600000 ||
      pending.createdAt > Date.now() ||
      !incoming.searchParams.get('code')
    ) {
      throw new Error(
        'El retorno de Google no es válido o venció. Pulsa Entrar con Google otra vez.',
      );
    }
    say('Comprobando acceso de operador…');
    const response = await fetch(config.issuer + '/token?grant_type=pkce', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      headers: { apikey: config.publicKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        auth_code: incoming.searchParams.get('code'),
        code_verifier: pending.verifier,
      }),
    });
    if (!response.ok)
      throw new Error(
        'No se pudo completar el acceso. Revisa el retorno permitido en Supabase y reintenta.',
      );
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
    const allowed = await fetch(
      config.root.replace(/\/docs\/preparacion\/$/, '') + '/admin/api/v1/preparacion/acceso',
      {
        headers: { authorization: 'Bearer ' + session.access_token },
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
        cache: 'no-store',
      },
    );
    if (allowed.status === 503)
      throw new Error(
        'El servicio de acceso no está disponible temporalmente. Inténtalo más tarde.',
      );
    if (allowed.status === 401)
      throw new Error('La sesión no es válida o venció. Vuelve a entrar con Google.');
    if (allowed.status === 403)
      throw new Error(
        'Tu cuenta Google no está autorizada como operador. Solicita su autorización local una sola vez.',
      );
    if (!allowed.ok || (await allowed.json()).autorizado !== true)
      throw new Error('No se pudo verificar el permiso de operador. Reintenta.');
    view = pending.view === 'contrato' ? 'contrato' : 'preparacion';
    token = session.access_token;
    active = true;
    expiration = window.setTimeout(
      () => clear('La sesión venció. Vuelve a entrar con Google.'),
      session.expires_in * 1000,
    );
    await openDocument(view);
    // Do not persist or refresh the provider session; reauthentication is explicit on expiry/reload.
  } catch (error) {
    clear(error.message || 'No se pudo iniciar sesión.');
  } finally {
    login.disabled = false;
  }
};
