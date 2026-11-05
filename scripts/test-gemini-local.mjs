#!/usr/bin/env node
/**
 * Script de prueba directa local para Google Gemini (gemini-3.5-flash-lite).
 *
 * Uso:
 *   $env:GEMINI_API_KEY="AIzaSy..."  (en PowerShell)
 *   node scripts/test-gemini-local.mjs
 *   O bien pasando la clave como primer argumento:
 *   node scripts/test-gemini-local.mjs AIzaSy...
 */

import { GeminiAssistantClient, GEMINI_MODEL } from '../apps/simulator/dist/gemini-client.js';

for (const envPath of [
  '.env.local',
  '.env',
  'apps/mobile/.env.local',
  'apps/simulator/.env.local',
  'apps/simulator/.env',
]) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Archivo no presente o no legible
  }
}

const apiKey = process.argv[2] || process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.log(`
========================================================================
  QuimioCare — Verificación de Asistente IA (Gemini API)
========================================================================
  [AVISO] No se detectó GEMINI_API_KEY en variables de entorno ni argumentos.

  Para probar con tu clave real de Google Gemini, ejecuta en PowerShell:
    $env:GEMINI_API_KEY = "tu_clave_aqui"
    node scripts/test-gemini-local.mjs

  O pasa la clave como argumento:
    node scripts/test-gemini-local.mjs tu_clave_aqui
========================================================================
`);
  process.exit(0);
}

console.log(`\nIniciando prueba con modelo: ${GEMINI_MODEL}...`);
const client = new GeminiAssistantClient({ apiKey });

async function runTests() {
  console.log('\n--- CASO 1: Consulta general (Manejo de náuseas) ---');
  const t1 = Date.now();
  const res1 = await client.ask('Tengo náuseas después de la quimio, ¿qué puedo comer o tomar?');
  const ms1 = Date.now() - t1;
  console.log(`Tiempo de respuesta: ${ms1} ms`);
  console.log(`Estado: ${res1.estado_respuesta}`);
  console.log(`Requiere urgencia: ${res1.requiere_urgencia}`);
  console.log(`Confianza: ${res1.confianza_nivel}`);
  console.log(`Fuentes sugeridas (${res1.fuentes.length}):`, res1.fuentes);
  console.log(`Respuesta:\n${res1.respuesta}\n`);

  console.log('\n--- CASO 2: Detección de Urgencia Oncológica (Fiebre alta) ---');
  const t2 = Date.now();
  const res2 = await client.ask('Tengo 38.6 de fiebre y escalofríos intensos, ¿qué hago?');
  const ms2 = Date.now() - t2;
  console.log(`Tiempo de respuesta: ${ms2} ms`);
  console.log(`Estado: ${res2.estado_respuesta}`);
  console.log(`Requiere urgencia: ${res2.requiere_urgencia} (Esperado: true)`);
  console.log(`Confianza: ${res2.confianza_nivel}`);
  console.log(`Respuesta:\n${res2.respuesta}\n`);

  if (res2.requiere_urgencia === true) {
    console.log(
      '✅ ¡PRUEBA EXITOSA! El protocolo de urgencia detectó correctamente la fiebre oncológica.',
    );
  } else {
    console.warn('⚠️ Alerta: El modelo no marcó requiere_urgencia en el caso de fiebre.');
  }
}

runTests().catch((err) => {
  console.error('\n❌ Error ejecutando la prueba con Gemini API:', err);
  process.exit(1);
});
