// Clifton Downs Live Weather Client & Diurnal Simulation Fallback
// Integrates with Open-Meteo API (Bristol/Clifton: 51.464, -2.628) with offline fallback.

export const WeatherType = Object.freeze({
  CLEAR: 'CLEAR',
  OVERCAST: 'OVERCAST',
  DRIZZLE: 'DRIZZLE',
  RAIN: 'RAIN',
  FOG: 'FOG'
});

/**
 * Maps WMO Weather Interpretation Codes (Open-Meteo) to domain WeatherType
 * @param {number|null|undefined} code - WMO code
 * @returns {string} WeatherType value
 */
export function mapWmoCodeToWeatherType(code) {
  if (code === 0 || code === 1) {
    return WeatherType.CLEAR;
  }
  if (code === 2 || code === 3) {
    return WeatherType.OVERCAST;
  }
  if (code === 45 || code === 48) {
    return WeatherType.FOG;
  }
  if (code === 51 || code === 53 || code === 55 || code === 56 || code === 57) {
    return WeatherType.DRIZZLE;
  }
  if (
    code === 61 || code === 63 || code === 65 ||
    code === 66 || code === 67 ||
    code === 80 || code === 81 || code === 82 ||
    code === 95 || code === 96 || code === 99
  ) {
    return WeatherType.RAIN;
  }
  return WeatherType.OVERCAST;
}

/**
 * Calculates a simulated diurnal weather state based on the provided hour or current local time.
 * Diurnal cycle:
 *   Morning (05:00 - 09:00): FOG or OVERCAST
 *   Midday  (09:00 - 15:00): CLEAR or OVERCAST
 *   Afternoon (15:00 - 19:00): DRIZZLE or RAIN
 *   Evening / Night (19:00 - 05:00): CLEAR or FOG
 *
 * @param {Date} [date] - Optional date reference (defaults to new Date())
 * @returns {{ weather: string, temperature: number, windSpeed: number }}
 */
export function simulateDiurnalWeather(date = new Date()) {
  const hour = date.getHours();
  const minute = date.getMinutes();
  const pseudoSeed = (hour * 60 + minute) % 100;

  let weather = WeatherType.CLEAR;
  let temperature = 14;
  let windSpeed = 12;

  if (hour >= 5 && hour < 9) {
    // Morning (05:00 - 09:00): FOG or OVERCAST
    weather = (pseudoSeed % 2 === 0) ? WeatherType.FOG : WeatherType.OVERCAST;
    temperature = 8 + (hour - 5) * 1.5;
    windSpeed = 6 + (pseudoSeed % 8);
  } else if (hour >= 9 && hour < 15) {
    // Midday (09:00 - 15:00): CLEAR or OVERCAST
    weather = (pseudoSeed % 3 === 0) ? WeatherType.OVERCAST : WeatherType.CLEAR;
    temperature = 14 + (hour - 9) * 0.8;
    windSpeed = 10 + (pseudoSeed % 12);
  } else if (hour >= 15 && hour < 19) {
    // Afternoon (15:00 - 19:00): DRIZZLE or RAIN
    weather = (pseudoSeed % 2 === 0) ? WeatherType.DRIZZLE : WeatherType.RAIN;
    temperature = 15 - (hour - 15) * 0.7;
    windSpeed = 14 + (pseudoSeed % 10);
  } else {
    // Evening / Night (19:00 - 05:00): CLEAR or FOG
    weather = (pseudoSeed % 3 === 0) ? WeatherType.FOG : WeatherType.CLEAR;
    temperature = 9 - (hour >= 19 ? (hour - 19) * 0.5 : (hour + 5) * 0.3);
    windSpeed = 5 + (pseudoSeed % 6);
  }

  return {
    weather,
    temperature: Math.round(temperature * 10) / 10,
    windSpeed: Math.round(windSpeed * 10) / 10
  };
}

export class WeatherClient {
  constructor(options = {}) {
    this.latitude = options.latitude ?? 51.464;
    this.longitude = options.longitude ?? -2.628;
    this.endpointUrl = options.endpointUrl ??
      `https://api.open-meteo.com/v1/forecast?latitude=${this.latitude}&longitude=${this.longitude}&current_weather=true`;

    this.currentWeather = WeatherType.CLEAR;
    this.temperature = 15;
    this.windSpeed = 10;
    this.isLive = false;
    this.lastUpdated = null;
    this.override = null;

    this.listeners = new Set();
    this.refreshTimer = null;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 5000;

    // Initialize immediately with diurnal simulation state so client is immediately usable
    this.applySimulation(new Date());
  }

  /**
   * Returns the active weather state, accounting for any test/debug override.
   * @returns {string} One of WeatherType
   */
  getWeather() {
    return this.override || this.currentWeather;
  }

  /**
   * Sets a forced weather override for testing/debug.
   * @param {string} weatherType - A valid WeatherType
   */
  setWeatherOverride(weatherType) {
    if (weatherType && Object.values(WeatherType).includes(weatherType)) {
      this.override = weatherType;
      this.notifyListeners();
    }
  }

  /**
   * Clears any active weather override.
   */
  clearWeatherOverride() {
    this.override = null;
    this.notifyListeners();
  }

  /**
   * Adds an observer listener notified on weather state change.
   * @param {Function} fn - (newWeather, info) => void
   */
  addListener(fn) {
    if (typeof fn === 'function') {
      this.listeners.add(fn);
    }
  }

  /**
   * Removes an observer listener.
   * @param {Function} fn
   */
  removeListener(fn) {
    this.listeners.delete(fn);
  }

  /**
   * Internal helper to notify all registered listeners.
   */
  notifyListeners() {
    const effectiveWeather = this.getWeather();
    const info = {
      weather: effectiveWeather,
      rawWeather: this.currentWeather,
      temperature: this.temperature,
      windSpeed: this.windSpeed,
      isLive: this.isLive,
      lastUpdated: this.lastUpdated,
      override: this.override
    };

    for (const listener of this.listeners) {
      try {
        listener(effectiveWeather, info);
      } catch (err) {
        console.error('[WeatherClient] Listener error:', err);
      }
    }
  }

  /**
   * Applies diurnal simulation fallback.
   * @param {Date} [date]
   */
  applySimulation(date = new Date()) {
    const sim = simulateDiurnalWeather(date);
    this.currentWeather = sim.weather;
    this.temperature = sim.temperature;
    this.windSpeed = sim.windSpeed;
    this.isLive = false;
    this.lastUpdated = Date.now();
  }

  /**
   * Asynchronously fetches live weather from Open-Meteo API.
   * Falls back to diurnal simulation if fetch fails, network is down, or response is invalid.
   * @returns {Promise<string>} Effective weather type
   */
  async fetchWeather() {
    // Check if fetch is available in environment
    const fetchFn = (typeof globalThis !== 'undefined' && globalThis.fetch)
      ? globalThis.fetch.bind(globalThis)
      : (typeof window !== 'undefined' && window.fetch)
        ? window.fetch.bind(window)
        : null;

    if (!fetchFn) {
      this.applySimulation();
      this.notifyListeners();
      return this.getWeather();
    }

    let controller = null;
    let timeoutId = null;

    try {
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        timeoutId = setTimeout(() => {
          if (controller) controller.abort();
        }, this.fetchTimeoutMs);
      }

      const fetchOptions = controller ? { signal: controller.signal } : {};
      const response = await fetchFn(this.endpointUrl, fetchOptions);

      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Weather API HTTP error ${response.status}`);
      }

      const data = await response.json();
      if (!data || !data.current_weather) {
        throw new Error('Invalid weather API response format');
      }

      const cw = data.current_weather;
      this.currentWeather = mapWmoCodeToWeatherType(cw.weathercode);
      this.temperature = typeof cw.temperature === 'number' ? cw.temperature : this.temperature;
      this.windSpeed = typeof cw.windspeed === 'number' ? cw.windspeed : this.windSpeed;
      this.isLive = true;
      this.lastUpdated = Date.now();
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      // Fallback to diurnal simulation
      this.applySimulation();
    }

    this.notifyListeners();
    return this.getWeather();
  }

  /**
   * Starts periodic auto-refreshing of weather.
   * @param {number} [intervalMs=600000] - Default 10 minutes
   */
  startAutoRefresh(intervalMs = 600000) {
    this.stopAutoRefresh();
    this.refreshTimer = setInterval(() => {
      this.fetchWeather();
    }, intervalMs);
  }

  /**
   * Stops auto-refresh timer.
   */
  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

export const weatherClient = new WeatherClient();
export default weatherClient;
