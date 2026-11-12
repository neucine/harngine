import type { Json } from 'harngine';
import type { ResearchBrief, SourceEnvelope } from './domain.js';
import { contentHash, verifyEnvelope } from './domain.js';
import { replaySources } from './replay.js';

const userAgent = 'Muse-Harngine-Reference/0.1 (https://github.com/harngine)';

async function request(url: string): Promise<Json> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': userAgent },
  });
  if (!response.ok) throw new Error(`Provider request failed (${response.status}) for ${url}`);
  return (await response.json()) as Json;
}

const cleanDoi = (value: string) => value.replace(/^https:\/\/doi\.org\//, '');
const text = (value: Json | undefined) => (typeof value === 'string' ? value : '');
const record = (value: Json | undefined): Record<string, Json> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function abstractText(value: Json | undefined): string {
  const index = record(value);
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index))
    if (Array.isArray(positions))
      for (const position of positions) if (typeof position === 'number') words[position] = word;
  return words.join(' ');
}

async function liveOpenAlex(): Promise<SourceEnvelope[]> {
  const dois = ['10.1093/qje/qju032', '10.1038/s41586-024-07500-2'];
  return Promise.all(
    dois.map(async (doi) => {
      const raw = record(await request(`https://api.openalex.org/works/https://doi.org/${doi}`));
      const authorships = Array.isArray(raw.authorships) ? raw.authorships : [];
      const location = record(raw.primary_location);
      const source = record(location.source);
      const content: Json = {
        doi: cleanDoi(text(raw.doi)),
        title: text(raw.title),
        year: raw.publication_year ?? null,
        authors: authorships.map((item) => text(record(record(item).author).display_name)),
        venue: text(source.display_name),
        citedBy: raw.cited_by_count ?? null,
        abstract: abstractText(raw.abstract_inverted_index),
      };
      return {
        provider: 'openalex',
        objectId: text(raw.id).split('/').at(-1) ?? doi,
        fetchedAt: new Date().toISOString(),
        mode: 'live',
        rights: doi.includes('s41586')
          ? 'Metadata: CC0; source article is CC BY 4.0'
          : 'Metadata: CC0; article reuse rights not supplied',
        sourceUrl: text(raw.id),
        contentHash: contentHash(content),
        content,
      };
    }),
  );
}

async function liveCrossref(): Promise<SourceEnvelope[]> {
  const dois = ['10.1093/qje/qju032', '10.1038/s41586-024-07500-2'];
  return Promise.all(
    dois.map(async (doi) => {
      const root = record(await request(`https://api.crossref.org/works/${doi}`));
      const raw = record(root.message);
      const dateParts = Array.isArray(record(raw.published)['date-parts'])
        ? (record(raw.published)['date-parts'] as Json[])
        : [];
      const date = Array.isArray(dateParts[0]) ? dateParts[0] : [];
      const licenses = Array.isArray(raw.license) ? raw.license : [];
      const license = text(record(licenses[0]).URL) || null;
      const content: Json = {
        title: Array.isArray(raw.title) ? (raw.title[0] ?? '') : '',
        published: date
          .filter((item) => typeof item === 'number')
          .map((item) => String(item).padStart(2, '0'))
          .join('-'),
        publisher: raw.publisher ?? '',
        venue: Array.isArray(raw['container-title']) ? (raw['container-title'][0] ?? '') : '',
        type: raw.type ?? '',
        license,
      };
      return {
        provider: 'crossref',
        objectId: doi,
        fetchedAt: new Date().toISOString(),
        mode: 'live',
        rights: license
          ? `Article: ${license}`
          : 'Bibliographic metadata: CC0; article reuse rights not supplied by Crossref',
        sourceUrl: `https://doi.org/${doi}`,
        contentHash: contentHash(content),
        content,
      };
    }),
  );
}

async function liveCommons(): Promise<SourceEnvelope[]> {
  const title = 'File:Big Desk Home Office Carrollton New Orleans.jpg';
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url%7Cextmetadata&format=json&origin=*`;
  const root = record(await request(url));
  const pages = record(record(root.query).pages);
  const page = record(Object.values(pages)[0]);
  const info = record(Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined);
  const metadata = record(info.extmetadata);
  const meta = (name: string) =>
    text(record(metadata[name]).value)
      .replace(/<[^>]+>/g, '')
      .trim();
  const license = meta('LicenseShortName');
  const attribution = meta('AttributionRequired') === 'true';
  const content: Json = {
    title: text(page.title)
      .replace(/^File:/, '')
      .replace(/\.jpg$/i, ''),
    artist: meta('Artist'),
    license,
    licenseUrl: meta('LicenseUrl'),
    attributionRequired: attribution,
    imageUrl: text(info.url),
  };
  return [
    {
      provider: 'wikimedia-commons',
      objectId: title,
      fetchedAt: new Date().toISOString(),
      mode: 'live',
      rights: `${license}; attribution ${attribution ? 'required' : 'not required'}`,
      sourceUrl: text(info.descriptionurl),
      contentHash: contentHash(content),
      content,
    },
  ];
}

export async function readProvider(
  provider: SourceEnvelope['provider'],
  brief: ResearchBrief,
): Promise<SourceEnvelope[]> {
  if (brief.mode === 'replay')
    return replaySources.filter((item) => item.provider === provider).map(verifyEnvelope);
  if (provider === 'openalex') return liveOpenAlex();
  if (provider === 'crossref') return liveCrossref();
  return liveCommons();
}
