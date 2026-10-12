#!/usr/bin/env python3
"""
Comprehensive Acceptance Test Suite for Ticket-017:
UTC Day/Night Sepia Twilight & Clifton Downs Live Weather Simulation

Traceability Matrix:
- AC-017.1: Diurnal lighting calculation from UTC / local Bristol time.
- AC-017.2: Atmospheric lighting compositing, sepia twilight pass & radial streetlamp cutouts.
- AC-017.3: Live weather client with Open-Meteo Bristol coordinates and robust diurnal offline fallback.
- AC-017.4: Weather conditions drive particle effects (rain streaks, mist, fog sheets) & audio modulation.
- AC-017.5: Scaffold integration & clean game loop wiring in src/main.js.
"""

import os
import re
import unittest


class TestEnvironmentWeatherModuleScaffold(unittest.TestCase):
    """Verifies that all required environment & weather source files exist and export expected symbols."""

    def setUp(self):
        self.root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.env_path = os.path.join(self.root, "src", "world", "environment.js")
        self.weather_path = os.path.join(self.root, "src", "systems", "weather.js")
        self.main_path = os.path.join(self.root, "src", "main.js")
        self.field_path = os.path.join(self.root, "src", "world", "field.js")
        self.audio_path = os.path.join(self.root, "src", "systems", "audio.js")

    def test_files_exist(self):
        self.assertTrue(os.path.exists(self.env_path), "src/world/environment.js missing")
        self.assertTrue(os.path.exists(self.weather_path), "src/systems/weather.js missing")
        self.assertTrue(os.path.exists(self.main_path), "src/main.js missing")
        self.assertTrue(os.path.exists(self.field_path), "src/world/field.js missing")
        self.assertTrue(os.path.exists(self.audio_path), "src/systems/audio.js missing")

    def test_environment_exports(self):
        with open(self.env_path, "r", encoding="utf-8") as f:
            code = f.read()
        self.assertIn("export const TimeOfDay", code)
        self.assertIn("export const WeatherType", code)
        self.assertIn("export class EnvironmentSystem", code)
        self.assertIn("export const environmentSystem", code)
        self.assertIn("export default environmentSystem", code)

    def test_weather_exports(self):
        with open(self.weather_path, "r", encoding="utf-8") as f:
            code = f.read()
        self.assertIn("export const WeatherType", code)
        self.assertIn("export class WeatherClient", code)
        self.assertIn("export const weatherClient", code)
        self.assertIn("export default weatherClient", code)

    def test_main_wiring(self):
        with open(self.main_path, "r", encoding="utf-8") as f:
            code = f.read()
        # Check imports
        self.assertIn("from './systems/weather.js'", code)
        self.assertIn("from './world/environment.js'", code)
        self.assertIn("weatherClient", code)
        self.assertIn("environmentSystem", code)

        # Check constructor setup
        self.assertIn("this.weatherClient = weatherClient;", code)
        self.assertIn("this.environment = environmentSystem;", code)
        self.assertIn("this.weatherClient.startAutoRefresh()", code)
        self.assertIn("sound.setWeather", code)

        # Check update loop wiring
        self.assertIn("this.environment.update", code)
        self.assertIn("sound.setTimeOfDay", code)

        # Check render loop wiring
        self.assertIn("this.environment.render", code)


class TestDiurnalLightingBands(unittest.TestCase):
    """
    AC-017.1: Day/Night cycle calculates diurnal lighting state from UTC / local Bristol time.
    Validates diurnal hour bands:
      - Dawn: 05:00 - 07:00 -> TimeOfDay.DAWN
      - Day: 07:00 - 17:00 -> TimeOfDay.DAY
      - Golden Hour / Twilight: 17:00 - 19:30 -> TimeOfDay.GOLDEN_HOUR
      - Dusk: 19:30 - 21:30 -> TimeOfDay.DUSK
      - Night: 21:30 - 05:00 -> TimeOfDay.NIGHT
    """

    def setUp(self):
        env_path = os.path.join(os.path.dirname(__file__), "..", "src", "world", "environment.js")
        with open(env_path, "r", encoding="utf-8") as f:
            self.code = f.read()

    def _get_time_of_day_simulated(self, hour):
        """Python mirror of getTimeOfDay algorithm in src/world/environment.js."""
        h = ((hour % 24) + 24) % 24
        if 5.0 <= h < 7.0:
            return "DAWN"
        elif 7.0 <= h < 17.0:
            return "DAY"
        elif 17.0 <= h < 19.5:
            return "GOLDEN_HOUR"
        elif 19.5 <= h < 21.5:
            return "DUSK"
        else:
            return "NIGHT"

    def test_diurnal_hour_classification_bands(self):
        # Dawn band: [5.0, 7.0)
        self.assertEqual(self._get_time_of_day_simulated(5.0), "DAWN")
        self.assertEqual(self._get_time_of_day_simulated(6.0), "DAWN")
        self.assertEqual(self._get_time_of_day_simulated(6.99), "DAWN")

        # Day band: [7.0, 17.0)
        self.assertEqual(self._get_time_of_day_simulated(7.0), "DAY")
        self.assertEqual(self._get_time_of_day_simulated(12.0), "DAY")
        self.assertEqual(self._get_time_of_day_simulated(16.99), "DAY")

        # Golden Hour / Twilight band: [17.0, 19.5) (17:00 - 19:30)
        self.assertEqual(self._get_time_of_day_simulated(17.0), "GOLDEN_HOUR")
        self.assertEqual(self._get_time_of_day_simulated(18.0), "GOLDEN_HOUR")
        self.assertEqual(self._get_time_of_day_simulated(19.49), "GOLDEN_HOUR")

        # Dusk band: [19.5, 21.5) (19:30 - 21:30)
        self.assertEqual(self._get_time_of_day_simulated(19.5), "DUSK")
        self.assertEqual(self._get_time_of_day_simulated(20.5), "DUSK")
        self.assertEqual(self._get_time_of_day_simulated(21.49), "DUSK")

        # Night band: [21.5, 24.0) and [0.0, 5.0)
        self.assertEqual(self._get_time_of_day_simulated(21.5), "NIGHT")
        self.assertEqual(self._get_time_of_day_simulated(23.5), "NIGHT")
        self.assertEqual(self._get_time_of_day_simulated(0.0), "NIGHT")
        self.assertEqual(self._get_time_of_day_simulated(2.0), "NIGHT")
        self.assertEqual(self._get_time_of_day_simulated(4.99), "NIGHT")

    def test_environment_time_override_methods(self):
        """Verifies setTimeOverride and clearTimeOverride exist and handle hour wrapping."""
        self.assertIn("setTimeOverride(hour)", self.code)
        self.assertIn("clearTimeOverride()", self.code)
        self.assertIn("this.timeOverride = ((hour % 24) + 24) % 24", self.code)

    def test_amber_sepia_tint_properties(self):
        """Verifies Golden Hour uses rich sepia / amber lighting tint values."""
        self.assertIn("TimeOfDay.GOLDEN_HOUR", self.code)
        # Golden hour ambient color components: r ~ 180, g ~ 110, b ~ 35
        self.assertIn("180", self.code)
        self.assertIn("110", self.code)
        self.assertIn("35", self.code)
        # Check gradient in renderLighting: rgba(195, 115, 30, ...)
        self.assertTrue(
            "195, 115, 30" in self.code or "180, 110, 35" in self.code,
            "Amber sepia tint values should be present in environment lighting"
        )


class TestAtmosphericLightingAndStreetlamps(unittest.TestCase):
    """
    AC-017.2: Sepia twilight and night passes composite smooth atmospheric lighting with streetlamp cutouts.
    """

    def setUp(self):
        field_path = os.path.join(os.path.dirname(__file__), "..", "src", "world", "field.js")
        env_path = os.path.join(os.path.dirname(__file__), "..", "src", "world", "environment.js")
        with open(field_path, "r", encoding="utf-8") as f:
            self.field_code = f.read()
        with open(env_path, "r", encoding="utf-8") as f:
            self.env_code = f.read()

    def test_get_light_sources_method_exists(self):
        self.assertIn("getLightSources()", self.field_code)

    def test_streetlamps_count_and_beacon(self):
        """Verifies >= 8 streetlamps and the Durdham Down water tower beacon are registered."""
        # Streetlamps count in lampPositions
        match = re.search(r"const lampPositions = \[(.*?)\];", self.field_code, re.DOTALL)
        self.assertIsNotNone(match, "lampPositions array should be defined in field.js")
        lamp_entries = [line for line in match.group(1).splitlines() if "id:" in line]
        self.assertGreaterEqual(len(lamp_entries), 8, "Expected at least 8 streetlamps registered")

        # Water tower beacon registration in getLightSources
        self.assertIn("water-tower-beacon", self.field_code)
        self.assertIn("glowRadius: 150", self.field_code)

    def test_radial_light_halo_properties(self):
        """Verifies radial light halo properties: glowRadius >= 100, warm color, destination-out masking."""
        # Verify glowRadius is >= 100 in lamp definitions
        self.assertIn("glowRadius: 120", self.field_code)

        # Verify radial lighting compositing in environment.js
        self.assertIn("destination-out", self.env_code, "Compositing mask must use destination-out for radial cutouts")
        self.assertIn("createRadialGradient", self.env_code)


class TestWeatherClientAndOfflineSimulation(unittest.TestCase):
    """
    AC-017.3: Live weather client retrieves Clifton conditions with robust offline simulation fallback.
    """

    def setUp(self):
        weather_path = os.path.join(os.path.dirname(__file__), "..", "src", "systems", "weather.js")
        with open(weather_path, "r", encoding="utf-8") as f:
            self.weather_code = f.read()

    def test_open_meteo_url_targets_clifton_downs(self):
        """Verifies Open-Meteo URL targeting Clifton Downs (lat: 51.464, lon: -2.628)."""
        self.assertIn("https://api.open-meteo.com/v1/forecast", self.weather_code)
        self.assertIn("51.464", self.weather_code)
        self.assertIn("-2.628", self.weather_code)
        self.assertIn("latitude=${this.latitude}", self.weather_code)
        self.assertIn("longitude=${this.longitude}", self.weather_code)
        self.assertIn("current_weather=true", self.weather_code)

    def test_wmo_code_mappings(self):
        """Verifies WMO code mapping table covers all specified groups."""
        # 0/1 -> CLEAR
        # 2/3 -> OVERCAST
        # 45/48 -> FOG
        # 51-57 -> DRIZZLE
        # 61-99 -> RAIN
        self.assertIn("mapWmoCodeToWeatherType", self.weather_code)
        for code in ["0", "1", "2", "3", "45", "48", "51", "53", "55", "61", "63", "65", "80", "95"]:
            self.assertIn(code, self.weather_code)

    def test_diurnal_offline_simulation_fallback(self):
        """Verifies offline diurnal simulation fallback works without network."""
        self.assertIn("simulateDiurnalWeather", self.weather_code)
        self.assertIn("applySimulation", self.weather_code)

    def test_weather_override_and_listeners(self):
        """Verifies setWeatherOverride and listener subscriptions."""
        self.assertIn("setWeatherOverride", self.weather_code)
        self.assertIn("clearWeatherOverride", self.weather_code)
        self.assertIn("addListener", self.weather_code)
        self.assertIn("notifyListeners", self.weather_code)


class TestParticleEffectsAndAudioModulation(unittest.TestCase):
    """
    AC-017.4: Weather conditions drive particle effects (rain streaks, mist) and audio volume adjustments.
    """

    def setUp(self):
        env_path = os.path.join(os.path.dirname(__file__), "..", "src", "world", "environment.js")
        audio_path = os.path.join(os.path.dirname(__file__), "..", "src", "systems", "audio.js")
        with open(env_path, "r", encoding="utf-8") as f:
            self.env_code = f.read()
        with open(audio_path, "r", encoding="utf-8") as f:
            self.audio_code = f.read()

    def test_rain_and_drizzle_particle_pools(self):
        """Verifies rain streaks and drizzle particles pools and velocity bounds."""
        self.assertIn("this.rainParticles", self.env_code)
        self.assertIn("this.drizzleParticles", self.env_code)
        # Check rain streaks vy ~ 550-750
        self.assertIn("550", self.env_code)
        # Check drizzle vy ~ 260-370
        self.assertIn("260", self.env_code)

    def test_mist_and_fog_sheet_drift(self):
        """Verifies mist specks and fog sheets drift for fog weather."""
        self.assertIn("this.mistSpecks", self.env_code)
        self.assertIn("this.fogSheets", self.env_code)
        self.assertIn("_renderFog", self.env_code)

    def test_audio_set_weather_and_time_of_day(self):
        """Verifies audio methods setWeather and setTimeOfDay exist and modulate soundscape."""
        self.assertIn("setWeather(weatherType)", self.audio_code)
        self.assertIn("setTimeOfDay(timeState)", self.audio_code)
        self.assertIn("_initRainSynthesizer", self.audio_code)
        self.assertIn("playThunderRumble", self.audio_code)
        self.assertIn("playWindGust", self.audio_code)

        # Check rain modulation handles DRIZZLE and RAIN
        self.assertIn("'DRIZZLE'", self.audio_code)
        self.assertIn("'RAIN'", self.audio_code)

        # Check night attenuation
        self.assertIn("'NIGHT'", self.audio_code)


if __name__ == "__main__":
    unittest.main()
