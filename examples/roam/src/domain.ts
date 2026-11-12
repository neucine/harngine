import type { Json } from 'harngine';

export type SourceState = 'live' | 'cached' | 'unavailable';
export interface Provenance extends Record<string, Json> {
  provider: string;
  state: SourceState;
  fetchedAt: string | null;
  url: string;
  note: string;
}
export interface Destination extends Record<string, Json> {
  id: string;
  name: string;
  query: string;
  latitude: number;
  longitude: number;
}
export interface Traveler extends Record<string, Json> {
  id: string;
  name: string;
  initials: string;
  color: string;
}
export type SignalKind = 'desire' | 'mood' | 'fascination' | 'rhythm' | 'constraint';
export interface AtlasSignal extends Record<string, Json> {
  id: string;
  kind: SignalKind;
  text: string;
  author: string;
  createdAt: string;
}
export interface SavedTrail extends Record<string, Json> {
  id: string;
  worldId: string;
  title: string;
  desire: string;
  savedAt: string;
}
export interface AtlasBrief extends Record<string, Json> {
  roomId: string;
  title: string;
  origin: string;
  destinations: Destination[];
  startDate: string;
  endDate: string;
  activeWorldId: string;
  travelers: Traveler[];
  signals: AtlasSignal[];
  reactions: Record<string, Json>;
  savedTrails: SavedTrail[];
}
export interface PlaceFact extends Record<string, Json> {
  id: string;
  requestedName: string;
  displayName: string;
  latitude: number;
  longitude: number;
  osmType: string;
  osmId: number;
}
export interface GeographyResearch extends Record<string, Json> {
  provenance: Provenance;
  places: PlaceFact[];
}
export interface WeatherDay extends Record<string, Json> {
  date: string;
  temperatureMin: number;
  temperatureMax: number;
  precipitationProbability: number;
  weatherCode: number;
}
export interface WeatherPlace extends Record<string, Json> {
  id: string;
  name: string;
  timezone: string;
  days: WeatherDay[];
}
export interface WeatherResearch extends Record<string, Json> {
  provenance: Provenance;
  places: WeatherPlace[];
}
export interface WorldDay extends Record<string, Json> {
  day: number;
  date: string;
  place: string;
  title: string;
  texture: string;
  pace: 'drift' | 'wander' | 'pulse';
  alternate: string;
}
export interface JourneyWorld extends Record<string, Json> {
  id: string;
  label: string;
  title: string;
  atmosphere: string;
  summary: string;
  fit: number;
  color: string;
  x: number;
  y: number;
  signalEchoes: string[];
  days: WorldDay[];
}
export interface ScoutNote extends Record<string, Json> {
  id: string;
  name: string;
  lens: string;
  color: string;
  note: string;
  changed: string;
}
export interface AtlasResult extends Record<string, Json> {
  status: 'ready';
  worlds: JourneyWorld[];
  scouts: ScoutNote[];
  observedAt: string;
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
function addDays(date: Date, days: number): Date {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}
function dates(start: string, end: string): string[] {
  const values: string[] = [];
  for (
    let value = new Date(`${start}T00:00:00Z`);
    value <= new Date(`${end}T00:00:00Z`);
    value = addDays(value, 1)
  )
    values.push(isoDate(value));
  return values;
}

export function demoBrief(now = new Date()): AtlasBrief {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return {
    roomId: 'atlas-japan-autumn',
    title: 'Japan, in soft focus',
    origin: 'Auckland',
    destinations: [
      { id: 'tokyo', name: 'Tokyo', query: 'Tokyo, Japan', latitude: 35.6764, longitude: 139.65 },
      {
        id: 'hakone',
        name: 'Hakone',
        query: 'Hakone, Kanagawa, Japan',
        latitude: 35.2324,
        longitude: 139.107,
      },
    ],
    startDate: isoDate(addDays(today, 4)),
    endDate: isoDate(addDays(today, 10)),
    activeWorldId: 'lantern-drift',
    travelers: [
      { id: 'maya', name: 'Maya', initials: 'MA', color: '#ff725e' },
      { id: 'leo', name: 'Leo', initials: 'LE', color: '#6b8cff' },
      { id: 'nora', name: 'Nora', initials: 'NO', color: '#cab45d' },
    ],
    signals: [
      {
        id: 'signal-soft',
        kind: 'mood',
        text: 'soft mornings',
        author: 'maya',
        createdAt: now.toISOString(),
      },
      {
        id: 'signal-food',
        kind: 'fascination',
        text: 'tiny neighbourhood kitchens',
        author: 'leo',
        createdAt: now.toISOString(),
      },
      {
        id: 'signal-pause',
        kind: 'rhythm',
        text: 'one beautiful pause each day',
        author: 'nora',
        createdAt: now.toISOString(),
      },
      {
        id: 'signal-step',
        kind: 'constraint',
        text: 'step-free where possible',
        author: 'maya',
        createdAt: now.toISOString(),
      },
      {
        id: 'signal-breakfast',
        kind: 'desire',
        text: 'quiet breakfast by a rain-streaked window',
        author: 'leo',
        createdAt: now.toISOString(),
      },
    ],
    reactions: { 'lantern-drift': 3, 'electric-quiet': 1, 'mountain-breath': 2 },
    savedTrails: [],
  };
}

type DayDraft = readonly [string, string, string, WorldDay['pace'], string];
interface WorldDraft {
  id: string;
  label: string;
  title: string;
  atmosphere: string;
  summary: string;
  fit: number;
  color: string;
  x: number;
  y: number;
  days: DayDraft[];
}

export function buildJourneyWorlds(brief: AtlasBrief): JourneyWorld[] {
  const range = dates(brief.startDate, brief.endDate);
  const echoes = brief.signals.slice(-3).map((signal) => signal.text);
  const drafts: WorldDraft[] = [
    {
      id: 'lantern-drift',
      label: 'tender · layered',
      title: 'Lantern drift',
      atmosphere: 'warm rain · paper light · quiet appetite',
      summary: 'A slow orbit through old Tokyo, with room for weather and accidental doorways.',
      fit: 94,
      color: '#ff725e',
      x: 24,
      y: 37,
      days: [
        [
          'Tokyo',
          'Arrive by glow',
          'A soft landing, dusk noodles, no need to perform.',
          'drift',
          'If rain lingers: trade the walk for a listening bar near the hotel.',
        ],
        [
          'Tokyo',
          'River before voices',
          'Asakusa at first light, then follow the Sumida south.',
          'wander',
          'If energy rises: continue into Kiyosumi for gardens and coffee.',
        ],
        [
          'Tokyo',
          'Small rooms, big ideas',
          'Print studios, ceramics, and whatever catches the group.',
          'wander',
          'If the group splits: design east or Yanaka kitchens, reunion at dusk.',
        ],
        [
          'Hakone',
          'Steam between trees',
          'A mountain pause shaped around mist, sound, and warmth.',
          'drift',
          'If clouds close in: onsen, sculpture halls, and a long shared lunch.',
        ],
        [
          'Tokyo',
          'Return with new eyes',
          'No checklist—just one neighbourhood chosen over breakfast.',
          'drift',
          'If everyone wants motion: ride the loop and exit on instinct.',
        ],
        [
          'Tokyo',
          'Electric twilight',
          'Architecture, record shops, and a table worth lingering at.',
          'pulse',
          'If quiet wins: swap Shibuya for Daikanyama backstreets.',
        ],
        [
          'Tokyo',
          'Leave a little unfinished',
          'Late breakfast and one final object to remember the feeling.',
          'drift',
          'If time compresses: stay local and write a note to your future selves.',
        ],
      ],
    },
    {
      id: 'electric-quiet',
      label: 'bright · curious',
      title: 'Electric quiet',
      atmosphere: 'blue hour · hidden speakers · precise delight',
      summary: 'Dense city energy in short vivid bursts, balanced by calm rooms and late starts.',
      fit: 88,
      color: '#6b8cff',
      x: 66,
      y: 25,
      days: [
        [
          'Tokyo',
          'Neon, lightly',
          'Check in, reset, then one bright street after dark.',
          'wander',
          'If jetlag bites: convenience-store picnic and city views from bed.',
        ],
        [
          'Tokyo',
          'Future fragments',
          'Waterfront air and small acts of wonder.',
          'pulse',
          'If crowds build: cross to a quiet museum and sketch what you noticed.',
        ],
        [
          'Tokyo',
          'Sound map',
          'Record stores, listening rooms, and a tiny counter dinner.',
          'pulse',
          'If ears tire: a bathhouse and early night become the main event.',
        ],
        [
          'Tokyo',
          'Design by instinct',
          'Follow materials, signs, and shopfronts rather than landmarks.',
          'wander',
          'If choices overwhelm: let the pattern scout pick three doors.',
        ],
        [
          'Hakone',
          'Blue mountain interval',
          'Rail rhythms, lake air, and a night outside the city hum.',
          'drift',
          'If visibility drops: make the weather the subject, not the obstacle.',
        ],
        [
          'Tokyo',
          'Night has layers',
          'An empty afternoon before a vivid final evening.',
          'pulse',
          'If the group wants calm: lantern alleys replace the skyline.',
        ],
        [
          'Tokyo',
          'One last signal',
          'Each person chooses a final sensory detail to carry home.',
          'drift',
          'If departure moves earlier: collect the details at breakfast.',
        ],
      ],
    },
    {
      id: 'mountain-breath',
      label: 'earthy · spacious',
      title: 'Mountain breath',
      atmosphere: 'cedar air · mineral water · unhurried distance',
      summary: 'The city becomes a threshold to a more spacious journey anchored in Hakone.',
      fit: 91,
      color: '#75a77d',
      x: 48,
      y: 69,
      days: [
        [
          'Tokyo',
          'Threshold city',
          'Notice the first textures, tastes, and sounds.',
          'drift',
          'If energy is good: add a twilight shrine walk.',
        ],
        [
          'Hakone',
          'Climb into quiet',
          'Travel early, settle slowly, let the mountain reset the group.',
          'drift',
          'If transfers feel heavy: turn the journey itself into the day.',
        ],
        [
          'Hakone',
          'Weather as guide',
          'Choose lake, forest, or museum only after looking outside.',
          'wander',
          'If rain arrives: make steam, tea, and sculpture the full itinerary.',
        ],
        [
          'Hakone',
          'A second slow day',
          'No checkout pressure; follow whichever thread remained unfinished.',
          'drift',
          'If restlessness appears: trace the old highway through cedar.',
        ],
        [
          'Tokyo',
          'Re-entry',
          'Return after lunch and feel the city at a new frequency.',
          'wander',
          'If the mountain spell holds: stay west and keep the pace low.',
        ],
        [
          'Tokyo',
          'Shared favourites',
          'Everyone leads one small hour; the group makes the connections.',
          'pulse',
          'If paths diverge: split for two hours, then exchange discoveries.',
        ],
        [
          'Tokyo',
          'Carry the weather home',
          'A final garden and a quiet departure ritual.',
          'drift',
          'If the airport calls: make the train window the final scene.',
        ],
      ],
    },
  ];
  return drafts.map((draft) => ({
    ...draft,
    fit: Math.max(60, Math.min(99, draft.fit + Number(brief.reactions[draft.id] ?? 0) * 2)),
    signalEchoes: echoes,
    days: draft.days.slice(0, range.length).map((day, index) => ({
      day: index + 1,
      date: range[index]!,
      place: day[0],
      title: day[1],
      texture: day[2],
      pace: day[3],
      alternate: day[4],
    })),
  }));
}

export function buildScoutNotes(brief: AtlasBrief, weather: WeatherResearch): ScoutNote[] {
  const rainy = weather.places
    .flatMap((place) => place.days)
    .filter((day) => day.precipitationProbability >= 40).length;
  const latest = brief.signals.at(-1)?.text ?? 'the group’s original spark';
  return [
    {
      id: 'scout-atmosphere',
      name: 'Aki',
      lens: 'atmosphere',
      color: '#ff725e',
      note: `I’m tracing where “${latest}” meets early light, steam, and neighbourhood scale.`,
      changed: rainy
        ? `${rainy} rain-shaped moments surfaced`
        : 'clearer skies opened longer wandering arcs',
    },
    {
      id: 'scout-rhythm',
      name: 'Mori',
      lens: 'rhythm & access',
      color: '#75a77d',
      note: 'I protect pauses, step-free transitions, and days that can breathe without collapsing.',
      changed: 'transfer intensity softened in two worlds',
    },
    {
      id: 'scout-surprise',
      name: 'Kumo',
      lens: 'surprising connections',
      color: '#6b8cff',
      note: 'I look for unlikely bridges: sound and weather, food and typography, distance and anticipation.',
      changed: 'a listening-bar thread now echoes the mountain rain',
    },
  ];
}
