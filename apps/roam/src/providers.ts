import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type {
  Destination,
  GeographyResearch,
  PlaceFact,
  Provenance,
  WeatherDay,
  WeatherPlace,
  WeatherResearch,
} from './domain.js';

type Cache = Record<string, { fetchedAt: string; value: unknown }>;
export interface TravelFactsProvider {
  geocode(destinations: Destination[], signal: AbortSignal): Promise<GeographyResearch>;
  weather(
    destinations: Destination[],
    startDate: string,
    endDate: string,
    signal: AbortSignal,
  ): Promise<WeatherResearch>;
}
const unavailable = (provider: string, url: string, note: string): Provenance => ({
  provider,
  state: 'unavailable',
  fetchedAt: null,
  url,
  note,
});
function readCache(path: string): Cache {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Cache;
  } catch {
    return {};
  }
}
function saveCache(path: string, cache: Cache) {
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
}
function fresh(item: Cache[string] | undefined, age: number): item is Cache[string] {
  return !!item && Date.now() - Date.parse(item.fetchedAt) < age;
}

export function liveTravelFacts(cachePath: string): TravelFactsProvider {
  const cache = readCache(cachePath);
  return {
    async geocode(destinations, signal) {
      const places: PlaceFact[] = [];
      let newest: string | null = null;
      let usedCache = true;
      try {
        for (let index = 0; index < destinations.length; index++) {
          const destination = destinations[index]!;
          const key = `nominatim:${destination.query}`;
          let item = cache[key];
          if (!fresh(item, 30 * 24 * 60 * 60 * 1000)) {
            if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1100));
            const url = new URL('https://nominatim.openstreetmap.org/search');
            url.searchParams.set('q', destination.query);
            url.searchParams.set('format', 'jsonv2');
            url.searchParams.set('limit', '1');
            const response = await fetch(url, {
              signal,
              headers: {
                'user-agent':
                  'Harngine-Roam/0.1 (public reference app; https://github.com/neucine/harngine)',
                accept: 'application/json',
              },
            });
            if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
            item = { fetchedAt: new Date().toISOString(), value: await response.json() };
            cache[key] = item;
            saveCache(cachePath, cache);
            usedCache = false;
          }
          if (newest === null || item.fetchedAt.localeCompare(newest) > 0) newest = item.fetchedAt;
          const first = (item.value as Array<Record<string, unknown>>)[0];
          if (!first) throw new Error(`No OpenStreetMap result for ${destination.query}`);
          places.push({
            id: destination.id,
            requestedName: destination.name,
            displayName: String(first.display_name),
            latitude: Number(first.lat),
            longitude: Number(first.lon),
            osmType: String(first.osm_type),
            osmId: Number(first.osm_id),
          });
        }
        return {
          provenance: {
            provider: 'OpenStreetMap · Nominatim',
            state: usedCache ? 'cached' : 'live',
            fetchedAt: newest,
            url: 'https://www.openstreetmap.org/copyright',
            note: usedCache
              ? 'Cached geocoding result; public responses are reused for 30 days.'
              : 'Live geocoding result. Requests are identified, serialized, and cached.',
          },
          places,
        };
      } catch (error) {
        return {
          provenance: unavailable(
            'OpenStreetMap · Nominatim',
            'https://www.openstreetmap.org/copyright',
            `Live geography unavailable: ${error instanceof Error ? error.message : 'request failed'}`,
          ),
          places: destinations.map((destination) => ({
            id: destination.id,
            requestedName: destination.name,
            displayName: `${destination.name} · traveler-provided coordinates`,
            latitude: destination.latitude,
            longitude: destination.longitude,
            osmType: 'traveler-input',
            osmId: 0,
          })),
        };
      }
    },
    async weather(destinations, startDate, endDate, signal) {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', destinations.map((item) => item.latitude).join(','));
      url.searchParams.set('longitude', destinations.map((item) => item.longitude).join(','));
      url.searchParams.set(
        'daily',
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      );
      url.searchParams.set('timezone', 'auto');
      url.searchParams.set('start_date', startDate);
      url.searchParams.set('end_date', endDate);
      const key = `weather:${url.searchParams.toString()}`;
      let item = cache[key];
      let state: 'live' | 'cached' = 'cached';
      try {
        if (!fresh(item, 60 * 60 * 1000)) {
          const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
          if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
          item = { fetchedAt: new Date().toISOString(), value: await response.json() };
          cache[key] = item;
          saveCache(cachePath, cache);
          state = 'live';
        }
        const rows = Array.isArray(item.value) ? item.value : [item.value];
        const places: WeatherPlace[] = rows.map((raw, placeIndex) => {
          const row = raw as Record<string, unknown>;
          const daily = row.daily as Record<string, unknown[]>;
          const dates = daily.time as string[];
          const days: WeatherDay[] = dates.map((date, index) => ({
            date,
            temperatureMin: Number(daily.temperature_2m_min?.[index]),
            temperatureMax: Number(daily.temperature_2m_max?.[index]),
            precipitationProbability: Number(daily.precipitation_probability_max?.[index] ?? 0),
            weatherCode: Number(daily.weather_code?.[index]),
          }));
          return {
            id: destinations[placeIndex]!.id,
            name: destinations[placeIndex]!.name,
            timezone: String(row.timezone),
            days,
          };
        });
        return {
          provenance: {
            provider: 'Open-Meteo',
            state,
            fetchedAt: item.fetchedAt,
            url: 'https://open-meteo.com/',
            note:
              state === 'live'
                ? 'Live forecast, recorded for this planning run.'
                : 'Forecast replayed from the one-hour provider cache.',
          },
          places,
        };
      } catch (error) {
        return {
          provenance: unavailable(
            'Open-Meteo',
            'https://open-meteo.com/',
            `Live forecast unavailable: ${error instanceof Error ? error.message : 'request failed'}`,
          ),
          places: [],
        };
      }
    },
  };
}
