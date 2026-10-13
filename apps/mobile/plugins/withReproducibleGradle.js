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

    return modConfig;
  });
}

module.exports = withReproducibleGradle;
