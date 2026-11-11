export type PlaceEvidence = {
  label: string;
  latitude: number;
  longitude: number;
  countryCode: string;
  source: 'OpenStreetMap';
  attribution: string;
};
export type WeatherDay = {
  date: string;
  code: number;
  precipitationProbability: number;
  precipitationMm: number;
  windGustKph: number;
};
export type WeatherEvidence = { timezone: string; days: WeatherDay[]; source: 'Open-Meteo' };
export type GuidanceEvidence = {
  profile: 'nz-data-govt';
  datasets: { title: string; url: string; updated: string | null }[];
  source: 'data.govt.nz';
};
export type PublicContext = {
  observedAt: string;
  place: PlaceEvidence;
  weather: WeatherEvidence;
  guidance: GuidanceEvidence;
};

type Fetch = typeof fetch;

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Public data request failed (${response.status})`);
  return (await response.json()) as T;
}

export class PublicDataClient {
  constructor(
    private readonly request: Fetch = fetch,
    private readonly userAgent = 'Hearth-Harngine-reference/0.1',
  ) {}

  async geocode(address: string, signal?: AbortSignal): Promise<PlaceEvidence> {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({
      q: address,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '1',
    }).toString();
    const results = await responseJson<
      {
        display_name: string;
        lat: string;
        lon: string;
        licence: string;
        address?: { country_code?: string };
      }[]
    >(
      await this.request(url, {
        ...(signal ? { signal } : {}),
        headers: { 'user-agent': this.userAgent, accept: 'application/json' },
      }),
    );
    const first = results[0];
    if (!first) throw new Error('No matching destination was found');
    return {
      label: first.display_name,
      latitude: Number(first.lat),
      longitude: Number(first.lon),
      countryCode: first.address?.country_code?.toUpperCase() ?? 'UNKNOWN',
      source: 'OpenStreetMap',
      attribution: first.licence,
    };
  }

  async forecast(
    latitude: number,
    longitude: number,
    timezone: string,
    signal?: AbortSignal,
  ): Promise<WeatherEvidence> {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      timezone,
      forecast_days: '16',
      daily: 'weather_code,precipitation_probability_max,precipitation_sum,wind_gusts_10m_max',
    }).toString();
    const value = await responseJson<{
      timezone: string;
      daily: {
        time: string[];
        weather_code: number[];
        precipitation_probability_max: number[];
        precipitation_sum: number[];
        wind_gusts_10m_max: number[];
      };
    }>(
      await this.request(url, {
        ...(signal ? { signal } : {}),
        headers: { accept: 'application/json' },
      }),
    );
    const days: WeatherDay[] = value.daily.time.map((date, index) => ({
      date,
      code: value.daily.weather_code[index] ?? 0,
      precipitationProbability: value.daily.precipitation_probability_max[index] ?? 0,
      precipitationMm: value.daily.precipitation_sum[index] ?? 0,
      windGustKph: value.daily.wind_gusts_10m_max[index] ?? 0,
    }));
    return { timezone: value.timezone, days, source: 'Open-Meteo' };
  }

  async nzGuidance(signal?: AbortSignal): Promise<GuidanceEvidence> {
    const url = new URL('https://catalogue.data.govt.nz/api/3/action/package_search');
    url.search = new URLSearchParams({
      q: 'Wellington City Council rubbish recycling',
      rows: '3',
    }).toString();
    const value = await responseJson<{
      success: boolean;
      result: { results: { title: string; name: string; metadata_modified?: string }[] };
    }>(
      await this.request(url, {
        ...(signal ? { signal } : {}),
        headers: { accept: 'application/json' },
      }),
    );
    if (!value.success) throw new Error('data.govt.nz did not return a successful response');
    return {
      profile: 'nz-data-govt',
      datasets: value.result.results.map((dataset) => ({
        title: dataset.title,
        url: `https://catalogue.data.govt.nz/dataset/${encodeURIComponent(dataset.name)}`,
        updated: dataset.metadata_modified ?? null,
      })),
      source: 'data.govt.nz',
    };
  }

  async context(
    address: string,
    timezone: string,
    observedAt: string,
    signal?: AbortSignal,
  ): Promise<PublicContext> {
    const place = await this.geocode(address, signal);
    const [weather, guidance] = await Promise.all([
      this.forecast(place.latitude, place.longitude, timezone, signal),
      place.countryCode === 'NZ'
        ? this.nzGuidance(signal)
        : Promise.resolve({
            profile: 'nz-data-govt',
            datasets: [],
            source: 'data.govt.nz',
          } satisfies GuidanceEvidence),
    ]);
    return { observedAt, place, weather, guidance };
  }
}
