/**
 * Declarative multi-location zone registry.
 *
 * Each zone describes its own world dimensions, ground palette, landmarks and
 * warp gates. Consumers should resolve configs through `getZoneConfig()` so
 * aliases and unknown ids are handled consistently.
 */

export const PARK_ZONES = {
  'clifton-commons': {
    id: 'clifton-commons',
    aliases: ['the-downs'],
    title: '🌳 The Downs',
    shortTitle: 'The Downs',
    biome: 'parkland',
    worldWidth: 3200,
    worldHeight: 2400,
    groundColors: {
      base: '#3e6b2c',
      dark: '#335824',
      light: '#4c8237',
      mown: '#447831',
      path: '#c8b693',
      pathEdge: '#968160',
      pathDetail: '#ded3be',
      dirt: '#8c7353',
      dirtEdge: '#6f573c',
    },
    warpGates: [
      {
        id: 'gate-downs-to-woodland',
        label: '🌲 To The Woodland',
        x: 110,
        y: 1200,
        radius: 48,
        targetZoneId: 'the-woodland',
        targetX: 3000,
        targetY: 1200,
        icon: '🌲',
        facing: 'west',
      },
      {
        id: 'gate-downs-to-beach',
        label: '🏖️ To The Beach',
        x: 1600,
        y: 2290,
        radius: 48,
        targetZoneId: 'the-beach',
        targetX: 1600,
        targetY: 200,
        icon: '🏖️',
        facing: 'south',
      },
    ],
  },

  'the-woodland': {
    id: 'the-woodland',
    title: '🌲 The Woodland',
    shortTitle: 'The Woodland',
    biome: 'woodland',
    worldWidth: 3200,
    worldHeight: 2400,
    groundColors: {
      base: '#2b4c20',
      dark: '#223d19',
      light: '#3a662c',
      mown: '#2f5223',
      path: '#785c42',
      pathEdge: '#594431',
      pathDetail: '#8e6f51',
      dirt: '#594431',
      dirtEdge: '#3e2e21',
    },
    landmark: {
      id: 'woodland-clearing',
      name: 'Ancient Woodland Clearing',
      x: 1550,
      y: 1100,
      radius: 40,
    },
    warpGates: [
      {
        id: 'gate-woodland-to-downs',
        label: '🌳 To The Downs',
        x: 3090,
        y: 1200,
        radius: 48,
        targetZoneId: 'clifton-commons',
        targetX: 220,
        targetY: 1200,
        icon: '🌳',
        facing: 'east',
      },
      {
        id: 'gate-woodland-to-beach',
        label: '🏖️ To The Beach',
        x: 110,
        y: 1900,
        radius: 48,
        targetZoneId: 'the-beach',
        targetX: 220,
        targetY: 1200,
        icon: '🏖️',
        facing: 'southwest',
      },
    ],
  },

  'the-beach': {
    id: 'the-beach',
    title: '🏖️ The Beach',
    shortTitle: 'The Beach',
    biome: 'coastal',
    worldWidth: 3200,
    worldHeight: 2400,
    groundColors: {
      base: '#dfbe82',
      dark: '#d4b070',
      light: '#e6c994',
      dune: '#c2a675',
      duneGrass: '#6e8c42',
      waterShallow: '#38bdf8',
      waterDeep: '#0284c7',
      surfFoam: '#f0fdfa',
    },
    landmarks: [
      {
        id: 'shipwreck-ribs',
        name: 'Weathered Timber Shipwreck Ribs',
        x: 2350,
        y: 1450,
        radius: 36,
        depthY: 1470,
      },
      {
        id: 'dune-lookout',
        name: 'Coastal Dune Lookout Post',
        x: 900,
        y: 340,
        radius: 32,
        depthY: 360,
      },
    ],
    warpGates: [
      {
        id: 'gate-beach-to-downs',
        label: '🌳 To The Downs',
        x: 1600,
        y: 110,
        radius: 48,
        targetZoneId: 'clifton-commons',
        targetX: 1600,
        targetY: 2180,
        icon: '🌳',
        facing: 'north',
      },
      {
        id: 'gate-beach-to-woodland',
        label: '🌲 To The Woodland',
        x: 110,
        y: 1200,
        radius: 48,
        targetZoneId: 'the-woodland',
        targetX: 220,
        targetY: 1900,
        icon: '🌲',
        facing: 'west',
      },
    ],
  },
};

export const PUBLIC_ZONE_IDS = [
  'clifton-commons',
  'the-downs',
  'the-woodland',
  'the-beach',
];

/**
 * Returns true when the given id refers to a public zone (either a registered
 * zone id or a known public alias). Private room ids return false.
 *
 * @param {string} zoneId
 * @returns {boolean}
 */
export function isPublicZoneId(zoneId) {
  if (!zoneId || typeof zoneId !== 'string') return false;
  return PUBLIC_ZONE_IDS.includes(zoneId) || Object.prototype.hasOwnProperty.call(PARK_ZONES, zoneId);
}

const DEFAULT_ZONE_ID = 'clifton-commons';

/**
 * Resolve a zone config by id or alias.
 * Falls back to the default zone ('clifton-commons') when unknown.
 *
 * @param {string} zoneId
 * @returns {object}
 */
export function getZoneConfig(zoneId) {
  if (zoneId && PARK_ZONES[zoneId]) {
    return PARK_ZONES[zoneId];
  }

  if (zoneId) {
    for (const key of Object.keys(PARK_ZONES)) {
      const zone = PARK_ZONES[key];
      if (Array.isArray(zone.aliases) && zone.aliases.includes(zoneId)) {
        return zone;
      }
    }
  }

  return PARK_ZONES[DEFAULT_ZONE_ID];
}

/**
 * Register (or replace) a zone config at runtime.
 * Useful for dynamic content and tests.
 *
 * @param {object} zoneConfig
 * @returns {object|null} The registered config, or null if invalid.
 */
export function registerZone(zoneConfig) {
  if (!zoneConfig || typeof zoneConfig !== 'object' || !zoneConfig.id) {
    return null;
  }
  PARK_ZONES[zoneConfig.id] = zoneConfig;
  return zoneConfig;
}
