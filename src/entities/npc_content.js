/**
 * Ambient NPC content tables, appearance palettes, PRNG, and speech selection.
 */

export function mulberry32(seed) {
  let s = (Math.floor(Number(seed)) || 0) >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NPC_SPEED = Object.freeze({
  walker: 35,
  jogger: 80
});

export const NPC_TYPES = Object.freeze(['walker', 'jogger']);

export const FIRST_NAMES = Object.freeze([
  'Alice', 'Arthur', 'Beatrice', 'Bob', 'Charlie', 'Colin', 'Diana', 'Dorothy',
  'Edward', 'Felix', 'Fiona', 'George', 'Grace', 'Hannah', 'Henry', 'Ian',
  'Iris', 'Jasper', 'Julia', 'Kevin', 'Kiran', 'Laura', 'Leo', 'Mary',
  'Maya', 'Michael', 'Nina', 'Noah', 'Oliver', 'Ophelia', 'Penny', 'Peter',
  'Quentin', 'Rachel', 'Rosa', 'Sam', 'Simon', 'Steve', 'Tara', 'Tess',
  'Umar', 'Victor', 'Victoria', 'William', 'Xena', 'Yusuf', 'Zara'
]);

export const SKIN_TONES = Object.freeze([
  '#fed7aa', '#fcd34d', '#fbcfe8', '#d4a373',
  '#a3704c', '#6f4e37', '#e2b59a', '#fecdd3'
]);

export const HAIR_COLORS = Object.freeze([
  '#451a03', '#1e293b', '#78350f', '#b45309',
  '#e2e8f0', '#92400e', '#292524'
]);

export const HAIR_STYLES = Object.freeze(['SHORT', 'WAVY', 'PONYTAIL', 'BEANIE']);

export const HAT_COLORS = Object.freeze([
  '#c2410c', '#0284c7', '#15803d', '#4338ca',
  '#334155', '#64748b', '#e11d48'
]);

export const WALKER_JACKETS = Object.freeze([
  '#1e3a8a', '#047857', '#b91c1c', '#b45309',
  '#475569', '#0f766e', '#6d28d9', '#3b82f6', '#334155'
]);

export const JOGGER_JACKETS = Object.freeze([
  '#10b981', '#f59e0b', '#ef4444', '#06b6d4',
  '#8b5cf6', '#ec4899', '#84cc16', '#3b82f6', '#f97316'
]);

export const WALKER_PANTS = Object.freeze([
  '#334155', '#1e293b', '#475569', '#374151', '#1f2937'
]);

export const JOGGER_PANTS = Object.freeze([
  '#0f172a', '#1e1b4b', '#18181b', '#0284c7', '#374151', '#4338ca'
]);

export const WALKER_SHOES = Object.freeze([
  '#0f172a', '#1e293b', '#334155', '#475569'
]);

export const JOGGER_SHOES = Object.freeze([
  '#f8fafc', '#38bdf8', '#fbbf24', '#f43f5e'
]);

export const NPC_TAG_STYLE = Object.freeze({
  text: '#fef08a',
  background: 'rgba(15, 23, 42, 0.85)',
  border: 'rgba(250, 204, 21, 0.4)',
  font: 'italic 600 11px ' + 'Outfit, sans-serif'
});

export const COMMON_PHRASES = Object.freeze([
  'Lovely morning for a stroll.',
  'The breeze feels refreshing today.',
  'Look at those autumn leaves!',
  'Such a beautiful park we have here.',
  'I always enjoy watching the dogs play.',
  'Fresh air always clears the mind.',
  'A great day to stretch the legs.',
  'What good dogs in the park today!',
  'The sun is warm today.',
  'Peace and quiet out here.',
  'Nice weather to get moving.',
  'Look at the birds by the pond.',
  'Can never spend too much time outdoors.',
  'Nothing beats a walk in nature.',
  'Such lovely green scenery.',
  'Just taking in the morning sights.',
  'Glad I brought my walking shoes.',
  'The flowers are blooming nicely.',
  'Good pace today!',
  'Always nice seeing happy pups.',
  'Enjoying every step of the path.',
  'The air is crisp and clean.',
  'What a charming little park.',
  'Walking keeps the heart young.',
  'Hello there, beautiful day isn\'t it?',
  'Just taking my daily lap.',
  'Sunbeams through the branches look nice.',
  'Nothing like an afternoon walk.',
  'So many tails wagging today.',
  'Good to be out and about.',
  'Such polite walkers around here.',
  'The trails look very well kept.'
]);

export const ODD_PHRASES = Object.freeze([
  'I think that squirrel owes me money.',
  'Did that tree just wink at me?',
  'Are we inside a simulation right now?',
  'I swear that dog understood every word I thought.',
  'My pedometer told me I walked to the moon.',
  'Is it just me, or do ducks have secret meetings?',
  'I forgot why I started jogging three miles ago.',
  'I wonder if dogs dream in color or tennis balls.',
  'A pigeon gave me directions this morning.',
  'Never trust a bench that looks too comfortable.',
  'I think my shadow is lagging slightly behind.'
]);

export function npcIdentityFromSeed(seed, type = 'walker') {
  const rng = mulberry32(seed);
  const isJogger = Boolean(type && type.toLowerCase() === 'jogger');
  const title = isJogger ? 'Jogger' : 'Walker';
  const firstName = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
  const name = `${firstName} the ${title}`;

  const skinTone = SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)];
  const hairColor = HAIR_COLORS[Math.floor(rng() * HAIR_COLORS.length)];
  const hairStyle = HAIR_STYLES[Math.floor(rng() * HAIR_STYLES.length)];
  const hatColor = HAT_COLORS[Math.floor(rng() * HAT_COLORS.length)];
  const jacketColor = isJogger
    ? JOGGER_JACKETS[Math.floor(rng() * JOGGER_JACKETS.length)]
    : WALKER_JACKETS[Math.floor(rng() * WALKER_JACKETS.length)];
  const pantsColor = isJogger
    ? JOGGER_PANTS[Math.floor(rng() * JOGGER_PANTS.length)]
    : WALKER_PANTS[Math.floor(rng() * WALKER_PANTS.length)];
  const shoeColor = isJogger
    ? JOGGER_SHOES[Math.floor(rng() * JOGGER_SHOES.length)]
    : WALKER_SHOES[Math.floor(rng() * WALKER_SHOES.length)];

  return {
    name,
    skinTone,
    hairColor,
    hairStyle,
    hatColor,
    jacketColor,
    pantsColor,
    shoeColor
  };
}

export function pickPhrase(rng) {
  const random = typeof rng === 'function' ? rng : Math.random;
  const roll = random();
  if (roll < 0.15) {
    return ODD_PHRASES[Math.floor(random() * ODD_PHRASES.length)];
  }
  return COMMON_PHRASES[Math.floor(random() * COMMON_PHRASES.length)];
}

export function nextSpeechDelay(rng) {
  const random = typeof rng === 'function' ? rng : Math.random;
  return 6.0 + random() * 8.0;
}
