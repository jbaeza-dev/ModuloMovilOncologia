// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withMainApplication } = require('expo/config-plugins');

const MARKER = '// QuimioCare: ping HTTP/2 para descartar conexiones muertas';
const IMPORTS = [
  'import com.facebook.react.modules.network.OkHttpClientProvider',
  'import java.util.concurrent.TimeUnit',
];
// Segundos entre pings en conexiones HTTP/2 inactivas. Si el servidor no responde, OkHttp descarta la
// conexión y la siguiente petición abre una nueva en lugar de esperar en un socket muerto.
const PING_SECONDS = 15;

/**
 * El cliente HTTP que comparten `fetch` de Expo y el de React Native no tiene ping ni tiempos de espera.
 * Una conexión HTTP/2 que la red corta sin avisar queda en el pool como sana y la siguiente petición
 * nunca llega (regresión del 26-11-2026: `POST /token` a Supabase sin registro y G-ESPERA en el ingreso).
 * Se registra una fábrica igual a la de React Native (caché y cookies incluidas) más el ping.
 */
function applyOkHttpKeepalive(contents) {
  if (contents.includes(MARKER)) return contents;
  if (!/^package [\w.]+\s*$/m.test(contents) || !contents.includes('class MainApplication'))
    throw new Error('MainApplication.kt con un formato inesperado: no se agregó el ping HTTP/2.');
  const anchor = /^(\s*)super\.onCreate\(\)\s*$/m;
  const match = contents.match(anchor);
  if (!match) throw new Error('No se encontró super.onCreate() en MainApplication.kt.');
  const indent = match[1];
  const factory = [
    `${indent}${MARKER} (G-ESPERA, 26-11-2026).`,
    `${indent}OkHttpClientProvider.setOkHttpClientFactory {`,
    `${indent}  OkHttpClientProvider.createClientBuilder(applicationContext)`,
    `${indent}    .pingInterval(${PING_SECONDS}, TimeUnit.SECONDS)`,
    `${indent}    .build()`,
    `${indent}}`,
  ].join('\n');
  let result = contents.replace(anchor, (line) => `${line}\n${factory}`);
  const missing = IMPORTS.filter((line) => !result.includes(line));
  if (missing.length)
    result = result.replace(/^(package [\w.]+\s*\n)/m, (pkg) => `${pkg}\n${missing.join('\n')}\n`);
  return result;
}

module.exports = (config) =>
  withMainApplication(config, (mod) => {
    if (mod.modResults.language !== 'kt')
      throw new Error('Se esperaba MainApplication en Kotlin para agregar el ping HTTP/2.');
    mod.modResults.contents = applyOkHttpKeepalive(mod.modResults.contents);
    return mod;
  });
module.exports.applyOkHttpKeepalive = applyOkHttpKeepalive;
module.exports.PING_SECONDS = PING_SECONDS;
