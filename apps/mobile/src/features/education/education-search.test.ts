import { describe, expect, it } from 'vitest';
import { searchEducationalContent } from './education-search';
import type { EducationalResource } from '../../data/local/education/education-types';

const resources: EducationalResource[] = [
  {
    id: 'image',
    title: 'Alimentación durante la quimioterapia',
    description: 'Guía ilustrada',
    category: 1,
    categoryName: 'Nutrición',
    type: 'infografia',
    version: 'one',
  },
  {
    id: 'video',
    title: 'Conoce tu tratamiento',
    description: 'Video educativo sobre quimioterapia',
    category: 2,
    categoryName: 'Mi tratamiento',
    type: 'video',
    version: 'one',
  },
];
describe('education search', () => {
  it('matches accents, uppercase and words in the description or category', () => {
    expect(
      searchEducationalContent(resources, 'ALIMENTACION QUIMIOTERAPIA').map((item) => item.id),
    ).toEqual(['image']);
    expect(searchEducationalContent(resources, 'nutricion').map((item) => item.id)).toEqual([
      'image',
    ]);
  });
  it('filters infographic and video results by their actual received type', () => {
    expect(
      searchEducationalContent(resources, 'quimioterapia', 'infografia').map((item) => item.id),
    ).toEqual(['image']);
    expect(
      searchEducationalContent(resources, 'quimioterapia', 'video').map((item) => item.id),
    ).toEqual(['video']);
  });
  it('finds the existing podcast list without adding sample catalog content', () => {
    const found = searchEducationalContent([], 'cancer', 'podcast');
    expect(found).toHaveLength(0);
  });
  it('does not reuse a previous catalog and returns no fictional match', () => {
    expect(searchEducationalContent([], 'alimentacion', 'infografia')).toEqual([]);
    expect(searchEducationalContent(resources, 'inexistente')).toEqual([]);
  });
});
