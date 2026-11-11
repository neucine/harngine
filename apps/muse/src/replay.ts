import type { SourceEnvelope } from './domain.js';
import { contentHash } from './domain.js';

const captured = '2026-10-11T02:00:00.000Z';
const envelope = (
  value: Omit<SourceEnvelope, 'contentHash' | 'fetchedAt' | 'mode'>,
): SourceEnvelope => ({
  ...value,
  fetchedAt: captured,
  mode: 'replay',
  contentHash: contentHash(value.content),
});

export const replaySources: readonly SourceEnvelope[] = [
  envelope({
    provider: 'openalex',
    objectId: 'W2161708711',
    sourceUrl: 'https://openalex.org/W2161708711',
    rights:
      'Metadata: CC0; abstract indexed from publisher record—quote sparingly and link to source',
    content: {
      doi: '10.1093/qje/qju032',
      title: 'Does Working from Home Work? Evidence from a Chinese Experiment',
      year: 2014,
      authors: ['Nicholas Bloom', 'James Liang', 'John Roberts', 'Zhichun Jenny Ying'],
      venue: 'The Quarterly Journal of Economics',
      citedBy: 2006,
      abstract:
        'A randomized nine-month experiment at Ctrip assigned volunteer call-center employees to home or office work. Home working led to a 13% performance increase; satisfaction improved and attrition halved, while promotion conditional on performance fell.',
    },
  }),
  envelope({
    provider: 'openalex',
    objectId: 'W4399567465',
    sourceUrl: 'https://openalex.org/W4399567465',
    rights: 'Metadata: CC0; source article is CC BY 4.0',
    content: {
      doi: '10.1038/s41586-024-07500-2',
      title: 'Hybrid working from home improves retention without damaging performance',
      year: 2024,
      authors: ['Nicholas Bloom', 'Ruobing Han', 'James Liang'],
      venue: 'Nature',
      citedBy: 302,
      abstract:
        'A six-month randomized trial of 1,612 employees found that hybrid working improved satisfaction and reduced quit rates by one-third. Equivalence tests found no effect on performance grades, promotions overall, or lines of code written.',
    },
  }),
  envelope({
    provider: 'crossref',
    objectId: '10.1093/qje/qju032',
    sourceUrl: 'https://doi.org/10.1093/qje/qju032',
    rights: 'Bibliographic metadata: CC0; article reuse rights not supplied by Crossref',
    content: {
      title: 'Does Working from Home Work? Evidence from a Chinese Experiment',
      published: '2014-11-20',
      publisher: 'Oxford University Press',
      venue: 'The Quarterly Journal of Economics',
      type: 'journal-article',
      license: null,
    },
  }),
  envelope({
    provider: 'crossref',
    objectId: '10.1038/s41586-024-07500-2',
    sourceUrl: 'https://doi.org/10.1038/s41586-024-07500-2',
    rights: 'Article: Creative Commons Attribution 4.0',
    content: {
      title: 'Hybrid working from home improves retention without damaging performance',
      published: '2024-06-12',
      publisher: 'Springer Nature',
      venue: 'Nature',
      type: 'journal-article',
      license: 'https://creativecommons.org/licenses/by/4.0',
    },
  }),
  envelope({
    provider: 'wikimedia-commons',
    objectId: 'File:Big Desk Home Office Carrollton New Orleans.jpg',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Big_Desk_Home_Office_Carrollton_New_Orleans.jpg',
    rights: 'CC BY 2.0; attribution required',
    content: {
      title: 'Big Desk Home Office Carrollton New Orleans',
      artist: 'Infrogmation of New Orleans',
      license: 'CC BY 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0',
      attributionRequired: true,
      imageUrl:
        'https://upload.wikimedia.org/wikipedia/commons/7/77/Big_Desk_Home_Office_Carrollton_New_Orleans.jpg',
    },
  }),
] as const;
