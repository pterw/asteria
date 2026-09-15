import { constellationPosition, MOOD_KEYS, type MoodKey } from "./astral";

const EXAMPLES: { title: string; content: string; mood: MoodKey; intensity: number }[] = [
  { title: "Sunlight, unannounced", content: "The afternoon sun found its way across the kitchen floor. I stood in that small rectangle of warmth for a little longer than I needed to.", mood: "luminous", intensity: 4 },
  { title: "The long way home", content: "We took the long way home, talking about nothing and everything. Some people make an ordinary Tuesday feel like somewhere you want to stay.", mood: "tender", intensity: 5 },
  { title: "A moment between things", content: "Rain kept time against the skylight and the whole apartment listened. For once, there was nowhere else I needed to be.", mood: "serene", intensity: 3 },
  { title: "Something clicked", content: "An idea arrived while I was washing the dishes. Not a grand revelation. Just a small door opening in a wall I thought was solid.", mood: "electric", intensity: 4 },
  { title: "Winter is negotiable", content: "Found the first green shoot in the window box. I almost missed it. Almost.", mood: "verdant", intensity: 3 },
  { title: "A familiar stranger", content: "An old song in a new café. For three minutes I was twenty again, then the coffee came and I was here. Both felt like home.", mood: "vesper", intensity: 3 },
  { title: "Small yeast miracles", content: "The bread I baked actually rose. We ate it standing up, still too hot, with butter melting into every little valley.", mood: "luminous", intensity: 3 },
  { title: "A thing remembered", content: "She remembered the small thing I mentioned once, months ago. Being listened to is its own kind of light.", mood: "tender", intensity: 5 },
  { title: "Blue before morning", content: "Espresso, cold hands, the city still blue. I was early for everything, even myself.", mood: "serene", intensity: 3 },
  { title: "Weather with wings", content: "A murmuration turned the sunset into weather. Everyone at the bus stop stopped looking at their phones.", mood: "electric", intensity: 5 },
  { title: "A quiet kind of persistence", content: "Moss in the pavement cracks, making a life in the places nobody planned for it.", mood: "verdant", intensity: 3 },
  { title: "Somewhere I used to know", content: "Homesick for a place I only visited once. Maybe what I miss is who I was there.", mood: "vesper", intensity: 4 },
  { title: "For the light", content: "Someone left oranges on the doorstep with a note: for the light. I put them in the blue bowl and the whole room felt different.", mood: "luminous", intensity: 5 },
  { title: "Kitchen dancing", content: "We danced in the kitchen to no music at all. The pasta overcooked. Neither of us minded.", mood: "tender", intensity: 4 },
  { title: "The whole city, a rumour", content: "Fog erased the skyline. I watched from the window until there were only the nearest roofs and my own reflection.", mood: "serene", intensity: 3 },
  { title: "A little voltage", content: "Lightning somewhere over the water. I counted the seconds like when I was nine, and forgot to be sensible.", mood: "electric", intensity: 4 },
  { title: "A fox at dawn", content: "A fox crossed the courtyard like punctuation, stopped to look at me, and went on with its much more interesting day.", mood: "verdant", intensity: 5 },
  { title: "In her handwriting", content: "Found grandmother’s recipe card, the ink fading into the vanilla stains. I made the cake a little wrong. She would have laughed.", mood: "vesper", intensity: 4 },
  { title: "Another century", content: "Power cut. Candles. We became people from another century for three hours. The power came back and we left the lights off.", mood: "luminous", intensity: 4 },
  { title: "The rest of the story", content: "He fell asleep mid-sentence, trusting me to carry the rest of the story.", mood: "tender", intensity: 5 },
  { title: "Nothing to fix", content: "Sat by the water for an hour. Didn't read. Didn't plan. Just watched the light move across it.", mood: "serene", intensity: 4 },
  { title: "Cold water clarity", content: "The lake at six in the morning. First the shock, then the absolute clarity. I came out laughing.", mood: "electric", intensity: 5 },
  { title: "Straight from the sun", content: "Strawberries warm from the sun, eaten straight off the plant. There is probably a word for this kind of enough.", mood: "verdant", intensity: 4 },
  { title: "A light still travelling", content: "Looked at a star and thought about how long its light took to get here. Some things reach us exactly when we need them.", mood: "vesper", intensity: 4 },
];
const OFFSETS = [0, 1, 2, 3, 4, 6, 7, 9, 10, 12, 14, 15, 17, 19, 21, 23, 25, 27, 30, 32, 35, 38, 41, 45];
export function makeSamples(journalId: string) {
  const counts = Object.fromEntries(MOOD_KEYS.map(m => [m, 0])) as Record<MoodKey, number>;
  return EXAMPLES.map((s, i) => ({
    ...s, journalId, isSample: true, favorite: [1, 7, 16].includes(i),
    createdAt: new Date(Date.now() - OFFSETS[i] * 86_400_000 - 60_000),
    ...constellationPosition(s.mood, counts[s.mood]++),
  }));
}
