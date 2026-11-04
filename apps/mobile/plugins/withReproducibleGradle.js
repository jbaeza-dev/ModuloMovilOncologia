// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Expo Config Plugin para asegurar compilaciones Android reproducibles en QuimioCare.
 * Inyecta:
 * 1. Declaración de `inputs.property("EXPO_PUBLIC_DEMO_MODE", ...)` en tareas de empaquetado Metro.
 * 2. `--reset-cache` en `extraPackagerArgs` para garantizar que la alternancia entre
 *    Release Demo y Release Estándar regenere el bundle sin reutilizar caché stale.
 */
function withReproducibleGradle(config) {
  return withAppBuildGradle(config, (modConfig) => {
    let buildGradle = modConfig.modResults.contents;
    const marker = '// QuimioCare: Reproducible Metro packager and demo mode settings';

    if (!buildGradle.includes(marker)) {
      const injection = `
${marker}
afterEvaluate {
    tasks.matching { it.name.startsWith("createBundle") && it.name.endsWith("JsAndAssets") }.configureEach {
        def demoModeVal = findProperty("EXPO_PUBLIC_DEMO_MODE") ?: (System.getenv("EXPO_PUBLIC_DEMO_MODE") ?: "")
        inputs.property("EXPO_PUBLIC_DEMO_MODE", demoModeVal)
        ["EXPO_PUBLIC_APP_ENV", "EXPO_PUBLIC_CLINICAL_URL", "EXPO_PUBLIC_GATEWAY_URL", "EXPO_PUBLIC_AUTH_URL", "EXPO_PUBLIC_AUTH_ISSUER", "EXPO_PUBLIC_AUTH_AUDIENCE", "EXPO_PUBLIC_AUTH_PUBLIC_KEY", "EXPO_PUBLIC_AUTH_REDIRECT_URI", "EXPO_PUBLIC_EXPO_PROJECT_ID", "EXPO_PUBLIC_P01_PROBE_ENABLED", "EXPO_PUBLIC_P01_CLINICAL_URL", "EXPO_PUBLIC_P01_POWERSYNC_URL", "EXPO_PUBLIC_P01_EXPO_PROJECT_ID", "EXPO_PUBLIC_P04_PROBE_ENABLED", "EXPO_PUBLIC_P04_LAB_ONLY", "EXPO_PUBLIC_P07_SYNTHETIC_REVIEW", "EXPO_PUBLIC_P07_HTTP_PROBE_URL", "EXPO_PUBLIC_POWERSYNC_URL"].each { key ->
            inputs.property(key, System.getenv(key) ?: "")
        }
        
        // Manejo compatible con ListProperty<String> o List estándar de Gradle
        try {
            if (extraPackagerArgs instanceof org.gradle.api.provider.ListProperty) {
                def currentArgs = extraPackagerArgs.getOrElse([])
                if (!currentArgs.contains("--reset-cache")) {
                    extraPackagerArgs.add("--reset-cache")
                }
            } else if (extraPackagerArgs instanceof List) {
                if (!extraPackagerArgs.contains("--reset-cache")) {
                    extraPackagerArgs.add("--reset-cache")
                }
            } else {
                extraPackagerArgs = ["--reset-cache"]
            }
        } catch (Exception ignored) {
            // Fallback para DSL de react { extraPackagerArgs }
        }
    }
}
`;
      buildGradle += injection;
      modConfig.modResults.contents = buildGradle;
    }

    // Upgrade the existing owned block when prebuild reuses the Android project.
    if (buildGradle.includes(marker) && !buildGradle.includes('"EXPO_PUBLIC_P04_LAB_ONLY"')) {
      buildGradle = buildGradle.replace(
        '"EXPO_PUBLIC_P01_EXPO_PROJECT_ID"].each',
        '"EXPO_PUBLIC_P01_EXPO_PROJECT_ID", "EXPO_PUBLIC_P04_PROBE_ENABLED", "EXPO_PUBLIC_P04_LAB_ONLY", "EXPO_PUBLIC_P07_SYNTHETIC_REVIEW", "EXPO_PUBLIC_P07_HTTP_PROBE_URL", "EXPO_PUBLIC_POWERSYNC_URL"].each',
      );
      if (!buildGradle.includes('"EXPO_PUBLIC_P04_LAB_ONLY"'))
        throw new Error('Revisar el bloque Gradle reproducible antes de cambiar de entorno.');
      modConfig.modResults.contents = buildGradle;
    }
    if (
      buildGradle.includes(marker) &&
      !buildGradle.includes('"EXPO_PUBLIC_P07_SYNTHETIC_REVIEW"')
    ) {
      buildGradle = buildGradle.replace(
        '"EXPO_PUBLIC_POWERSYNC_URL"].each',
        '"EXPO_PUBLIC_P07_SYNTHETIC_REVIEW", "EXPO_PUBLIC_P07_HTTP_PROBE_URL", "EXPO_PUBLIC_POWERSYNC_URL"].each',
      );
      if (!buildGradle.includes('"EXPO_PUBLIC_P07_SYNTHETIC_REVIEW"'))
        throw new Error('Revisar las entradas Gradle del laboratorio P07.');
      modConfig.modResults.contents = buildGradle;
    }
    if (buildGradle.includes(marker) && !buildGradle.includes('"EXPO_PUBLIC_P07_HTTP_PROBE_URL"')) {
      buildGradle = buildGradle.replace(
        '"EXPO_PUBLIC_POWERSYNC_URL"].each',
        '"EXPO_PUBLIC_P07_HTTP_PROBE_URL", "EXPO_PUBLIC_POWERSYNC_URL"].each',
      );
      if (!buildGradle.includes('"EXPO_PUBLIC_P07_HTTP_PROBE_URL"'))
        throw new Error('Revisar las entradas Gradle de la prueba HTTP nativa.');
      modConfig.modResults.contents = buildGradle;
    }
    return modConfig;
  });
}

module.exports = withReproducibleGradle;
