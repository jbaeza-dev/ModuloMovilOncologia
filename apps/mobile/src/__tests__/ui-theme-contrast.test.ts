import { describe, expect, it } from 'vitest';

import { PALETTE_OPTIONS, resolveTheme, type ColorScheme, type PaletteId } from '../theme';

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return [r, g, b];
}

function channelLuminance(val: number): number {
  return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Accesibilidad y Contraste Semántico (UX-04, UX-06)', () => {
  const schemes: ColorScheme[] = ['light', 'dark'];
  const paletteIds: PaletteId[] = PALETTE_OPTIONS.map((p) => p.id);

  describe.each(schemes)('Modo %s', (scheme) => {
    describe.each(paletteIds)('Paleta %s', (paletteId) => {
      const theme = resolveTheme(paletteId, scheme);

      it('cumple contraste mínimo de texto normal (>= 4.5:1) entre texto y fondo', () => {
        const ratio = contrastRatio(theme.colors.text, theme.colors.background);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });

      it('cumple contraste mínimo de texto normal (>= 4.5:1) entre texto y superficie', () => {
        const ratio = contrastRatio(theme.colors.text, theme.colors.surface);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });

      it('cumple contraste mínimo en botón principal (>= 4.5:1 o >= 3:1)', () => {
        const ratio = contrastRatio(theme.colors.onPrimary, theme.colors.primary);
        expect(ratio).toBeGreaterThanOrEqual(3.0);
      });

      it('cumple contraste semántico entre error y onError (>= 4.5:1) eliminando texto blanco sobre rosa en oscuro', () => {
        const ratio = contrastRatio(theme.colors.onError, theme.colors.error);
        expect(ratio).toBeGreaterThanOrEqual(4.5);

        // En oscuro comprueba que onError sea oscuro sobre #EF9A9A (~7.57:1)
        if (scheme === 'dark') {
          expect(theme.colors.onError).toBe('#202020');
          expect(ratio).toBeGreaterThan(7.0);
        } else {
          // En claro comprueba que onError sea blanco sobre #B3261E (~6.54:1)
          expect(theme.colors.onError).toBe('#FFFFFF');
          expect(ratio).toBeGreaterThan(6.0);
        }
      });

      it('cumple contraste no textual de controles (>= 3:1) para el borde de campo editable (inputBorder)', () => {
        const ratioVsSurface = contrastRatio(theme.colors.inputBorder, theme.colors.surface);
        const ratioVsBackground = contrastRatio(theme.colors.inputBorder, theme.colors.background);

        // Al menos con el fondo de superficie o de pantalla debe superar 3:1
        expect(Math.max(ratioVsSurface, ratioVsBackground)).toBeGreaterThanOrEqual(3.0);
      });
    });
  });

  describe('Tokens tipográficos de adaptación (UX-04)', () => {
    const theme = resolveTheme('turquoise', 'light');

    it('expone escala tipográfica completa para títulos, cuerpo, etiquetas y botones', () => {
      expect(theme.typography.screenTitle.fontSize).toBe(28);
      expect(theme.typography.sectionTitle.fontSize).toBe(20);
      expect(theme.typography.body.fontSize).toBe(16);
      expect(theme.typography.label.fontSize).toBe(16);
      expect(theme.typography.editableValue.fontSize).toBe(18);
      expect(theme.typography.button.fontSize).toBe(16);
      expect(theme.typography.helper.fontSize).toBe(14);
    });
  });
});
