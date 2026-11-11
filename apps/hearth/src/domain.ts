import { createHash } from 'node:crypto';
import type { PublicContext, WeatherDay } from './public-data.js';

export type PersonId = 'alex' | 'sam';
export type Visibility = 'shared' | 'private';
export type Participant = { id: PersonId; name: string; initials: string; colour: string };
export type CheckIn = {
  id: string;
  author: PersonId;
  energy: 1 | 2 | 3 | 4 | 5;
  feeling: string;
  note: string;
  visibility: Visibility;
  createdAt: string;
};
export type Memory = {
  id: string;
  title: string;
  detail: string;
  date: string;
  season: string;
  contributors: PersonId[];
  visibility: Visibility;
  tone: 'warm' | 'bright' | 'quiet' | 'tender';
  chapter?: 'moving-home';
};
export type Ritual = {
  id: string;
  title: string;
  description: string;
  cadence: string;
  createdAt: string;
  createdBy: PersonId;
  visibility: Visibility;
};
export type HomeRecord = {
  version: number;
  homeId: string;
  name: string;
  address: string;
  timezone: string;
  participants: Participant[];
  checkIns: CheckIn[];
  memories: Memory[];
  rituals: Ritual[];
  dismissedOpenings: { id: string; by: PersonId; at: string }[];
};
export type HomeView = Omit<HomeRecord, 'checkIns' | 'memories' | 'rituals'> & {
  viewer: PersonId;
  checkIns: CheckIn[];
  memories: Memory[];
  rituals: Ritual[];
};
export type MemoryBloom = {
  id: string;
  title: string;
  detail: string;
  dateLabel: string;
  tone: Memory['tone'];
  x: number;
  y: number;
  size: number;
  private: boolean;
  chapter: string | null;
};
export type GentleOpening = {
  id: string;
  title: string;
  body: string;
  invitation: string;
  why: string;
  ritual: { title: string; description: string; cadence: string };
};
export type HearthWorld = {
  generatedAt: string;
  homeId: string;
  homeName: string;
  viewer: PersonId;
  version: number;
  season: { name: string; phrase: string; light: number };
  localWeather: {
    summary: string;
    detail: string;
    rain: number;
    wind: number;
    code: number;
    source: string;
  };
  householdWeather: {
    name: string;
    detail: string;
    warmth: number;
    energy: number;
    perspectives: { name: string; energy: number; feeling: string; private: boolean }[];
  };
  rhythms: { title: string; observation: string; confidence: 'forming' | 'familiar' }[];
  blooms: MemoryBloom[];
  rituals: Ritual[];
  opening: GentleOpening | null;
  provenance: { observedAt: string; place: string; sources: { label: string; detail: string }[] };
};

function stableNumber(seed: string, modulo: number): number {
  return Number.parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) % modulo;
}
function currentDay(context: PublicContext): WeatherDay | undefined {
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: context.weather.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(context.observedAt));
  return context.weather.days.find((day) => day.date === localDate) ?? context.weather.days[0];
}
function seasonFor(date: string): HearthWorld['season'] {
  const month = new Date(date).getUTCMonth() + 1;
  if (month >= 9 && month <= 11)
    return { name: 'Spring', phrase: 'light returning, edges softening', light: 0.78 };
  if (month === 12 || month <= 2)
    return { name: 'Summer', phrase: 'long evenings, doors left open', light: 0.92 };
  if (month >= 3 && month <= 5)
    return { name: 'Autumn', phrase: 'gathering close, keeping what matters', light: 0.58 };
  return { name: 'Winter', phrase: 'small warmth, held carefully', light: 0.38 };
}
function weatherWords(day: WeatherDay | undefined): { summary: string; detail: string } {
  if (!day)
    return { summary: 'Beyond the forecast', detail: 'The outside world is quiet for now.' };
  if (day.windGustKph >= 80)
    return {
      summary: 'A restless sky',
      detail: `${day.precipitationProbability}% rain, with strong gusts moving through.`,
    };
  if (day.precipitationProbability >= 60)
    return {
      summary: 'Rain around the house',
      detail: `${day.precipitationMm.toFixed(1)} mm expected; a day for shelter and softer plans.`,
    };
  if (day.code <= 1)
    return {
      summary: 'Clear air',
      detail: 'The neighbourhood has a little more room around it today.',
    };
  return {
    summary: 'Changeable light',
    detail: 'Cloud and brightness are taking turns over the neighbourhood.',
  };
}
function householdWeather(view: HomeView): HearthWorld['householdWeather'] {
  const latest = new Map<PersonId, CheckIn>();
  for (const checkIn of [...view.checkIns].reverse())
    if (!latest.has(checkIn.author)) latest.set(checkIn.author, checkIn);
  const perspectives = view.participants.flatMap((person) => {
    const checkIn = latest.get(person.id);
    return checkIn
      ? [
          {
            name: person.name,
            energy: checkIn.energy,
            feeling: checkIn.feeling,
            private: checkIn.visibility === 'private',
          },
        ]
      : [];
  });
  const energy = perspectives.length
    ? perspectives.reduce((sum, item) => sum + item.energy, 0) / perspectives.length
    : 3;
  const spread =
    perspectives.length > 1 ? Math.abs(perspectives[0]!.energy - perspectives[1]!.energy) : 0;
  if (spread >= 2)
    return {
      name: 'Different skies under one roof',
      detail: 'There is room for unlike kinds of day here. Nothing needs to be evened out.',
      warmth: 0.7,
      energy,
      perspectives,
    };
  if (energy <= 2.4)
    return {
      name: 'A low, quiet tide',
      detail: 'The house seems to be asking for fewer words and more gentleness.',
      warmth: 0.58,
      energy,
      perspectives,
    };
  if (energy >= 4)
    return {
      name: 'Bright weather indoors',
      detail: 'There is a little surplus energy moving between rooms.',
      warmth: 0.9,
      energy,
      perspectives,
    };
  return {
    name: 'Settled with a few crosswinds',
    detail: 'The household feels steady enough to notice the small things.',
    warmth: 0.76,
    energy,
    perspectives,
  };
}
function blooms(view: HomeView): MemoryBloom[] {
  return view.memories.map((memory, index) => ({
    id: memory.id,
    title: memory.title,
    detail: memory.detail,
    dateLabel: new Intl.DateTimeFormat('en-NZ', { month: 'short', year: 'numeric' }).format(
      new Date(`${memory.date}T12:00:00Z`),
    ),
    tone: memory.tone,
    x: index === 0 ? 58 : 12 + stableNumber(`${memory.id}:x`, 77),
    y: index === 0 ? 26 : 12 + stableNumber(`${memory.id}:y`, 68),
    size: 40 + stableNumber(`${memory.id}:size`, 34),
    private: memory.visibility === 'private',
    chapter: memory.chapter === 'moving-home' ? 'A moving-home chapter' : null,
  }));
}
function openingFor(
  view: HomeView,
  inside: HearthWorld['householdWeather'],
  rain: number,
): GentleOpening | null {
  const id =
    rain >= 60 ? 'rain-window-tea' : inside.energy <= 2.5 ? 'lamp-hour' : 'threshold-pause';
  if (
    view.dismissedOpenings.some((item) => item.id === id && item.by === view.viewer) ||
    view.rituals.some((ritual) => ritual.id === id)
  )
    return null;
  if (id === 'rain-window-tea')
    return {
      id,
      title: 'A window-and-tea evening?',
      body: 'Rain is circling the neighbourhood, and the house has held a few different kinds of day.',
      invitation:
        'Ten unhurried minutes by the window. Tea, no fixing, one thing each that stayed with you.',
      why: 'Suggested from today’s local rain and the household check-ins visible to you. Private words were not shared.',
      ritual: {
        title: 'Window tea',
        description: 'Tea by the window; one noticed thing each, with no need to solve it.',
        cadence: 'On rainy evenings when it feels welcome',
      },
    };
  if (id === 'lamp-hour')
    return {
      id,
      title: 'Let the house become smaller tonight',
      body: 'Energy has been quiet lately. A ritual can protect that without making it a problem.',
      invitation: 'One lamp, one room, phones elsewhere for the first twenty minutes home.',
      why: 'Suggested from the recent energy pattern shared with Hearth.',
      ritual: {
        title: 'Lamp hour',
        description: 'Begin the evening in one softly lit room, without phones.',
        cadence: 'On low-energy evenings',
      },
    };
  return {
    id,
    title: 'Notice the threshold',
    body: 'This home is still becoming itself. The first minute through the door can be part of that story.',
    invitation: 'Pause at the threshold and name one thing the house gave you today.',
    why: 'Suggested because the moving-home chapter is still young and the household feels settled.',
    ritual: {
      title: 'Threshold pause',
      description: 'On arriving home, name one thing the house gave you today.',
      cadence: 'When coming home together',
    },
  };
}

export function buildHearthWorld(view: HomeView, context: PublicContext): HearthWorld {
  const day = currentDay(context);
  const outside = weatherWords(day);
  const inside = householdWeather(view);
  return {
    generatedAt: context.observedAt,
    homeId: view.homeId,
    homeName: view.name,
    viewer: view.viewer,
    version: view.version,
    season: seasonFor(context.observedAt),
    localWeather: {
      ...outside,
      rain: day?.precipitationProbability ?? 0,
      wind: day?.windGustKph ?? 0,
      code: day?.code ?? 0,
      source: 'Open-Meteo',
    },
    householdWeather: inside,
    rhythms: [
      {
        title: 'The late-week softening',
        observation:
          'By Thursday, the house tends to want less coordination and more parallel rest.',
        confidence: 'forming',
      },
      {
        title: 'Soup makes a centre',
        observation: 'Shared meals have become the easiest place for stories to surface.',
        confidence: 'familiar',
      },
    ],
    blooms: blooms(view),
    rituals: view.rituals,
    opening: openingFor(view, inside, day?.precipitationProbability ?? 0),
    provenance: {
      observedAt: context.observedAt,
      place: context.place.label,
      sources: [
        { label: 'Outside weather', detail: 'Open-Meteo forecast, observed for this home’s area.' },
        {
          label: 'Place',
          detail: 'OpenStreetMap is used only to locate the surrounding neighbourhood.',
        },
        {
          label: 'Household memory',
          detail: `Version ${view.version}; private traces are visible only to their author.`,
        },
      ],
    },
  };
}

export function defaultHome(): HomeRecord {
  return {
    version: 1,
    homeId: 'harbour-house',
    name: 'Harbour House',
    address: 'Cuba Street, Te Aro, Wellington, New Zealand',
    timezone: 'Pacific/Auckland',
    participants: [
      { id: 'alex', name: 'Alex', initials: 'A', colour: '#e9956f' },
      { id: 'sam', name: 'Sam', initials: 'S', colour: '#7aa69d' },
    ],
    checkIns: [
      {
        id: 'seed-alex',
        author: 'alex',
        energy: 2,
        feeling: 'tender',
        note: 'A full day. Glad to be home.',
        visibility: 'private',
        createdAt: '2026-10-11T17:10:00+13:00',
      },
      {
        id: 'seed-sam',
        author: 'sam',
        energy: 4,
        feeling: 'open',
        note: 'The rain made the rooms feel close in a good way.',
        visibility: 'shared',
        createdAt: '2026-10-11T17:25:00+13:00',
      },
    ],
    memories: [
      {
        id: 'first-night',
        title: 'The first night here',
        detail:
          'Boxes everywhere; fish and chips on the floor; the kettle was the first thing we found.',
        date: '2026-08-22',
        season: 'late winter',
        contributors: ['alex', 'sam'],
        visibility: 'shared',
        tone: 'warm',
        chapter: 'moving-home',
      },
      {
        id: 'hallway-laugh',
        title: 'The hallway echo',
        detail: 'We discovered how loudly laughter travels from the kitchen.',
        date: '2026-09-03',
        season: 'early spring',
        contributors: ['alex', 'sam'],
        visibility: 'shared',
        tone: 'bright',
      },
      {
        id: 'quiet-corner',
        title: 'A corner that became mine',
        detail: 'Morning light, the green chair, no explanation needed.',
        date: '2026-09-19',
        season: 'spring',
        contributors: ['alex'],
        visibility: 'private',
        tone: 'quiet',
      },
      {
        id: 'soup-sunday',
        title: 'Sunday soup',
        detail: 'Rain on the windows and enough time for the long version of every story.',
        date: '2026-10-04',
        season: 'spring',
        contributors: ['alex', 'sam'],
        visibility: 'shared',
        tone: 'tender',
      },
    ],
    rituals: [
      {
        id: 'sunday-soup',
        title: 'Sunday soup',
        description: 'Something slow on the stove; everyone gets the long version.',
        cadence: 'Most Sundays',
        createdAt: '2026-09-06T18:00:00+12:00',
        createdBy: 'sam',
        visibility: 'shared',
      },
    ],
    dismissedOpenings: [],
  };
}
