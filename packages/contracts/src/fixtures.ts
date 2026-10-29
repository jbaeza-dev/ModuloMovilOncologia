import approvedTerms from '../fixtures/quimiocare-terminos-v3_0.json' with { type: 'json' };
import followupForm from '../fixtures/epro-seguimiento-domiciliario-v1_1_0.json' with { type: 'json' };
import mobile from '../fixtures/fixtures-mobile-unificados.json' with { type: 'json' };
import provisionalForm from '../fixtures/formulario-41-preguntas-provisional-unificado.json' with { type: 'json' };
import originalFormRows from '../fixtures/filas-origen-fixture-epro.json' with { type: 'json' };
import conditions from '../fixtures/casos-condiciones-tecnicas.json' with { type: 'json' };
import exclusivityExamples from '../fixtures/ejemplos-exclusividades-objetivo.json' with { type: 'json' };
import imageMetadata from '../fixtures/imagen-prueba-metadatos-objetivo.json' with { type: 'json' };

// Fixtures are synthetic provenance, not evidence of clinical approval of a new edition.
export const fixtures = {
  mobile,
  approvedTerms,
  followupForm,
  provisionalForm,
  originalFormRows,
  conditions,
  exclusivityExamples,
  imageMetadata,
};
export const fixtureImageUrl = new URL('../fixtures/imagen-prueba.png', import.meta.url);
