# OpenSpec SDD: Task Specification

```yaml
---
ticket_id: "ticket-017"
title: "UTC Day/Night Sepia Twilight & Clifton Downs Live Weather Simulation"
state: "PLANNING"
created_at: "2026-10-12T17:54:00Z"
base_branch: "main"
ticket_branch: "factory/ticket-017/main"
max_review_cycles: 3
---
```

## 1. Problem Statement & Functional Goals

To achieve maximum immersion and a distinct sense of place for **The Downs**:
1. **Dynamic Lighting Pass**:
   - The park should reflect real-time time of day (UTC / Bristol local time), transitioning through bright daylight, warm golden hour, evocative sepia twilight, and dark night illuminated by glowing park lamps.
2. **Live Clifton Weather**:
   - Integrates live meteorological data for Clifton, Bristol (coordinates `51.464, -2.628`) via Open-Meteo API with offline simulated fallback.
   - Weather states (clear, overcast, drizzle, rain, fog) trigger canvas particle overlays and modulated audio soundscape.

---

## 2. System Architecture & Technical Specifications

### 2.1 Live Weather Client (`src/systems/weather.js`)
- Fetch Clifton Downs weather via `https://api.open-meteo.com/v1/forecast?latitude=51.464&longitude=-2.628&current_weather=true`.
- Fallback to simulated diurnal weather cycle if offline or network unavailable.
- Exports weather types: `'CLEAR'`, `'OVERCAST'`, `'DRIZZLE'`, `'RAIN'`, `'FOG'`.

### 2.2 Environment & Lighting Shader Pass (`src/world/environment.js`)
- Diurnal sun angle calculated from UTC/local hour.
- Renders full-screen ambient lighting overlay:
  - Daytime: warm subtle sun tint.
  - Golden Hour / Twilight: rich sepia-tinted amber gradient.
  - Night: deep navy/charcoal ambient shadow with radial light halos around park streetlamps and landmarks.
- Weather particle simulation (rain streaks, mist drifting).

### 2.3 Audio & Scenery Integration (`src/systems/audio.js`, `src/world/field.js`)
- Modulate ambient nature soundscape: rain on leaves, distant rumble, wind gusts during precipitation.
- Streetlamp glow sources registered in `field.js`.

---

## 3. Acceptance Criteria & Traceability Matrix

| ID | Criterion | Verification Method |
|---|---|---|
| **AC-017.1** | Day/night cycle calculates diurnal lighting state from UTC / local time. | Unit test diurnal calculation |
| **AC-017.2** | Sepia twilight and night passes composite smooth atmospheric lighting with streetlamp cutouts. | Canvas compositing test |
| **AC-017.3** | Live weather client retrieves Clifton conditions with robust offline simulation fallback. | Unit test weather parser & fallback |
| **AC-017.4** | Weather conditions drive particle effects (rain streaks, mist) and audio volume adjustments. | Unit test particle & audio binding |
| **AC-017.5** | Zero regressions across test suites (`python3 test/run_tests.py`). | Test runner verification |

---

## 4. Testing & Verification Strategy
- Author `test/test_environment_weather.py` covering diurnal lighting math, weather API response decoding, and particle lifecycle.
