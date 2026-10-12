import { afterEach, describe, expect, it, vi } from 'vitest';

import { computeSha256 } from '../../utils/crypto';
import { migrateDatabase } from './migrations';
import { createPatientRepository, seedPatientContextIfEmpty } from './repository';
import { createSqliteTestHarness, ids, patientA, patientB } from './testing/sqlite-test-harness';
import { buildYouTubeUrls, launchYouTubeVideo, parseYouTubeVideoId } from './education/youtube';

const harness = createSqliteTestHarness();
const { open } = harness;

afterEach(() => {
  harness.cleanup();
});

describe('Educación multimedia - YouTube (URLs, parsing, fallback)', () => {
  it('extrae y valida identificadores válidos de 11 caracteres y rechaza inválidos', () => {
    // 11 caracteres válidos directos
    expect(parseYouTubeVideoId('psfP_n8eP40')).toBe('psfP_n8eP40');
    expect(parseYouTubeVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');

    // URLs estándar de YouTube
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=psfP_n8eP40')).toBe('psfP_n8eP40');
    expect(parseYouTubeVideoId('https://m.youtube.com/watch?v=psfP_n8eP40&feature=share')).toBe(
      'psfP_n8eP40',
    );
    expect(parseYouTubeVideoId('http://youtube.com/watch?v=psfP_n8eP40')).toBe('psfP_n8eP40');

    // URLs cortas youtu.be
    expect(parseYouTubeVideoId('https://youtu.be/psfP_n8eP40')).toBe('psfP_n8eP40');
    expect(parseYouTubeVideoId('https://youtu.be/psfP_n8eP40?t=42')).toBe('psfP_n8eP40');

    // URLs de embed y shorts
    expect(parseYouTubeVideoId('https://www.youtube.com/embed/psfP_n8eP40')).toBe('psfP_n8eP40');
    expect(parseYouTubeVideoId('https://www.youtube.com/shorts/psfP_n8eP40')).toBe('psfP_n8eP40');

    // Inválidos: menos o más de 11 caracteres, caracteres extraños, dominios ajenos
    expect(parseYouTubeVideoId('')).toBeNull();
    expect(parseYouTubeVideoId('abc')).toBeNull();
    expect(parseYouTubeVideoId('123456789012')).toBeNull(); // 12 caracteres
    expect(parseYouTubeVideoId('psfP_n8eP40!')).toBeNull();
    expect(parseYouTubeVideoId('https://vimeo.com/12345678901')).toBeNull();
    expect(parseYouTubeVideoId('https://malicious.site/watch?v=psfP_n8eP40')).toBeNull();
  });

  it('construye URLs de app y web correctamente', () => {
    const urls = buildYouTubeUrls('psfP_n8eP40');
    expect(urls.videoId).toBe('psfP_n8eP40');
    expect(urls.appUrl).toBe('vnd.youtube:psfP_n8eP40');
    expect(urls.webUrl).toBe('https://www.youtube.com/watch?v=psfP_n8eP40');

    expect(() => buildYouTubeUrls('invalido')).toThrow(/inválido/i);
  });

  it('launchYouTubeVideo usa app nativa si canOpenURL es true, o degrada a web', async () => {
    // 1. App nativa disponible
    const mockNativeLinking = {
      canOpenURL: vi.fn().mockResolvedValue(true),
      openURL: vi.fn().mockResolvedValue(undefined),
    };
    const res1 = await launchYouTubeVideo('psfP_n8eP40', mockNativeLinking);
    expect(res1.success).toBe(true);
    expect(res1.openedVia).toBe('app');
    expect(mockNativeLinking.openURL).toHaveBeenCalledWith('vnd.youtube:psfP_n8eP40');

    // 2. App nativa no disponible -> degrada a web
    const mockWebLinking = {
      canOpenURL: vi.fn().mockResolvedValue(false),
      openURL: vi.fn().mockResolvedValue(undefined),
    };
    const res2 = await launchYouTubeVideo('psfP_n8eP40', mockWebLinking);
    expect(res2.success).toBe(true);
    expect(res2.openedVia).toBe('web');
    expect(mockWebLinking.openURL).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=psfP_n8eP40',
    );

    // 3. Fallo en apertura
    const mockFailLinking = {
      canOpenURL: vi.fn().mockResolvedValue(false),
      openURL: vi.fn().mockRejectedValue(new Error('Sin navegador')),
    };
    const res3 = await launchYouTubeVideo('psfP_n8eP40', mockFailLinking);
    expect(res3.success).toBe(false);
    expect(res3.error).toContain('Sin navegador');
  });
});

describe('Educación multimedia - Repositorio SQLite (interacciones y copias)', () => {
  it('registra interacciones de YouTube y valida invalidación de revisión por cambio de versión', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const eduA = repoA.education;

    // 1. Registro inicial sin revisión declarada
    const inter1 = await eduA.recordYouTubeInteraction({
      contentId: 'edu-vid-intro',
      youtubeVideoId: 'psfP_n8eP40',
      versionOrigen: '1.0.0',
    });
    expect(inter1.youtubeVideoId).toBe('psfP_n8eP40');
    expect(inter1.versionOrigen).toBe('1.0.0');
    expect(inter1.revisionDeclaradaEn).toBeNull();

    // 2. Declarar revisado con coincidencia exacta de ID y versión
    const declFail = await eduA.declareYouTubeReviewed({
      contentId: 'edu-vid-intro',
      youtubeVideoId: 'psfP_n8eP40',
      versionOrigen: '2.0.0', // Versión distinta debe fallar
    });
    expect(declFail.updated).toBe(false);

    const declSuccess = await eduA.declareYouTubeReviewed({
      contentId: 'edu-vid-intro',
      youtubeVideoId: 'psfP_n8eP40',
      versionOrigen: '1.0.0',
    });
    expect(declSuccess.updated).toBe(true);

    const reviewed = await eduA.getInteraction('edu-vid-intro');
    expect(reviewed?.revisionDeclaradaEn).toBeTruthy();
    const originalReviewDate = reviewed?.revisionDeclaradaEn;

    // 3. Re-registro con MISMO video y MISMA versión: CONSERVA la revisión declarada
    await eduA.recordYouTubeInteraction({
      contentId: 'edu-vid-intro',
      youtubeVideoId: 'psfP_n8eP40',
      versionOrigen: '1.0.0',
    });
    const preserved = await eduA.getInteraction('edu-vid-intro');
    expect(preserved?.revisionDeclaradaEn).toBe(originalReviewDate);

    // 4. Re-registro con MISMO video pero NUEVA versión (1.0.0 -> 2.0.0): INVALIDA la revisión
    await eduA.recordYouTubeInteraction({
      contentId: 'edu-vid-intro',
      youtubeVideoId: 'psfP_n8eP40',
      versionOrigen: '2.0.0',
    });
    const invalidated = await eduA.getInteraction('edu-vid-intro');
    expect(invalidated?.versionOrigen).toBe('2.0.0');
    expect(invalidated?.revisionDeclaradaEn).toBeNull();
  });

  it('guarda copias locales y exige identidad de versión Y SHA-256 para conservar la revisión', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const eduA = repoA.education;

    const sha1 = '1111111111111111111111111111111111111111111111111111111111111111';
    const sha2 = '2222222222222222222222222222222222222222222222222222222222222222';

    // 1. Guardar copia inicial
    await eduA.saveLocalCopy({
      contentId: 'edu-infografia-guia',
      rutaLocal: '/data/user/0/recursos_educativos/A/infografia_v1.png',
      formato: 'png',
      tamanoBytes: 54321,
      metadataLocal: {
        sha256: sha1,
        versionOrigen: '1.0.0',
        mimeType: 'image/png',
      },
    });

    const initialCopy = await eduA.getLocalCopy('edu-infografia-guia');
    expect(initialCopy?.revisionDeclarada).toBe(false);
    expect(initialCopy?.metadataLocal?.sha256).toBe(sha1);

    // 2. Declarar revisada
    await eduA.declareCopyReviewed('edu-infografia-guia');
    const reviewedCopy = await eduA.getLocalCopy('edu-infografia-guia');
    expect(reviewedCopy?.revisionDeclarada).toBe(true);
    expect(reviewedCopy?.revisionDeclaradaEn).toBeTruthy();
    const originalDate = reviewedCopy?.revisionDeclaradaEn;

    // 3. Re-guardar con MISMA versión y MISMO sha256: CONSERVA la revisión
    await eduA.saveLocalCopy({
      contentId: 'edu-infografia-guia',
      rutaLocal: '/data/user/0/recursos_educativos/A/infografia_v1_sync.png',
      formato: 'png',
      tamanoBytes: 54321,
      metadataLocal: {
        sha256: sha1,
        versionOrigen: '1.0.0',
        mimeType: 'image/png',
      },
    });
    const preservedCopy = await eduA.getLocalCopy('edu-infografia-guia');
    expect(preservedCopy?.revisionDeclarada).toBe(true);
    expect(preservedCopy?.revisionDeclaradaEn).toBe(originalDate);

    // 4. Re-guardar con MISMA versión pero DISTINTO sha256: RESETEA revisión
    await eduA.saveLocalCopy({
      contentId: 'edu-infografia-guia',
      rutaLocal: '/data/user/0/recursos_educativos/A/infografia_modificada.png',
      formato: 'png',
      tamanoBytes: 55000,
      metadataLocal: {
        sha256: sha2,
        versionOrigen: '1.0.0',
        mimeType: 'image/png',
      },
    });
    const resetBySha = await eduA.getLocalCopy('edu-infografia-guia');
    expect(resetBySha?.revisionDeclarada).toBe(false);
    expect(resetBySha?.revisionDeclaradaEn).toBeNull();
    expect(resetBySha?.metadataLocal?.sha256).toBe(sha2);

    // Volver a declarar revisada para probar cambio de versión
    await eduA.declareCopyReviewed('edu-infografia-guia');
    expect((await eduA.getLocalCopy('edu-infografia-guia'))?.revisionDeclarada).toBe(true);

    // 5. Re-guardar con NUEVA versión pero mismo sha2: RESETEA revisión
    await eduA.saveLocalCopy({
      contentId: 'edu-infografia-guia',
      rutaLocal: '/data/user/0/recursos_educativos/A/infografia_v2.png',
      formato: 'png',
      tamanoBytes: 55000,
      metadataLocal: {
        sha256: sha2,
        versionOrigen: '2.0.0',
        mimeType: 'image/png',
      },
    });
    const resetByVersion = await eduA.getLocalCopy('edu-infografia-guia');
    expect(resetByVersion?.revisionDeclarada).toBe(false);
    expect(resetByVersion?.revisionDeclaradaEn).toBeNull();
  });

  it('aísla completamente copias e interacciones entre Paciente A y Paciente B', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    await repoA.education.recordYouTubeInteraction({
      contentId: 'edu-vid-1',
      youtubeVideoId: 'psfP_n8eP40',
      versionOrigen: '1.0.0',
    });
    await repoA.education.saveLocalCopy({
      contentId: 'edu-guia-1',
      rutaLocal: '/data/A/guia.md',
      formato: 'markdown',
      tamanoBytes: 1200,
    });

    // Paciente B no ve las interacciones ni copias de Paciente A
    expect(await repoB.education.getInteraction('edu-vid-1')).toBeNull();
    expect(await repoB.education.listInteractions()).toHaveLength(0);
    expect(await repoB.education.getLocalCopy('edu-guia-1')).toBeNull();
    expect(await repoB.education.listLocalCopies()).toHaveLength(0);
  });

  it('calcula SHA-256 idéntico para texto y bytes binarios reales', async () => {
    const text = 'Texto de prueba educativa';
    const textSha = await computeSha256(text);
    expect(textSha).toMatch(/^[a-f0-9]{64}$/);

    // Bytes binarios reales
    const bytes = new TextEncoder().encode(text);
    const binarySha = await computeSha256(bytes);
    expect(binarySha).toBe(textSha);

    // Bytes binarios puros (ej. cabecera PNG: 89 50 4E 47 0D 0A 1A 0A)
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const pngSha = await computeSha256(pngHeader);
    expect(pngSha).toMatch(/^[a-f0-9]{64}$/);
  });
});
