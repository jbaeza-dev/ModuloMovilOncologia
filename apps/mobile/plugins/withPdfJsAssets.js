// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withDangerousMod, withAppBuildGradle } = require('expo/config-plugins');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

/**
 * Expo Config Plugin para asegurar que los activos de Mozilla PDF.js
 * se incorporen de forma reproducible en el proyecto Android en:
 * 1. Durante 'expo prebuild' (copia directa al directorio de assets nativo).
 * 2. Durante la ejecución de Gradle (tarea 'copyPdfJsAssets' conectada a preBuild).
 */
function withPdfJsAssets(config) {
  // 1. Hook para 'expo prebuild': copia desde assets/pdfjs hacia android/app/src/main/assets/pdfjs
  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const srcDir = path.resolve(projectRoot, 'assets/pdfjs');
      const destDir = path.resolve(
        modConfig.modRequest.platformProjectRoot,
        'app/src/main/assets/pdfjs',
      );
      if (fs.existsSync(srcDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        for (const file of fs.readdirSync(srcDir)) {
          fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        }
      }
      return modConfig;
    },
  ]);

  // 2. Hook para 'app/build.gradle': tarea reproducible para Gradle puro y CI limpio
  config = withAppBuildGradle(config, (modConfig) => {
    let buildGradle = modConfig.modResults.contents;
    const marker = '// QuimioCare: Copy PDF.js assets into Android assets';
    if (!buildGradle.includes(marker)) {
      buildGradle += `
${marker}
tasks.register("copyPdfJsAssets", Copy) {
    from(file("\${projectDir}/../../assets/pdfjs"))
    into(file("\${projectDir}/src/main/assets/pdfjs"))
}
preBuild.dependsOn(copyPdfJsAssets)
`;
      modConfig.modResults.contents = buildGradle;
    }
    return modConfig;
  });

  return config;
}

module.exports = withPdfJsAssets;
