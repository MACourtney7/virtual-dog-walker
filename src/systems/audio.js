// Procedural Web Audio API Sound Synthesizer & Clifton Down Ambient Nature Engine

class SoundSynthesizer {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.ambientStarted = false;
    this.breezeNode = null;

    // Weather & diurnal state
    this.currentWeather = 'CLEAR';
    this.currentTimeOfDay = 'DAY';

    // Rain synthesis nodes
    this.rainSource = null;
    this.rainGainNode = null;
    this.rainLowpassFilter = null;
    this.rainBandpassFilter = null;

    // Periodic weather effect timers
    this.weatherTimer = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  unlockAudio() {
    if (!this.ctx) {
      this.ensureContext();
    } else if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Realistic Cheerful Cocker Spaniel Bark
  playBark() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    // Formant filter for canine vocal tract resonance
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, t);
    filter.Q.setValueAtTime(3.5, t);

    // Pitch envelope: sharp attack, slight upward scoop, quick decay
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.04);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.18);

    // Volume envelope
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.22);
    gain.gain.setValueAtTime(0, t + 0.23);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.24);
  }

  // Authentic Procedural Dog Training Whistle
  playWhistle() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;

    // Carrier Oscillator (Sine wave sweeping ~2400 Hz to ~2850 Hz)
    const carrier = this.ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(2400, t);
    carrier.frequency.exponentialRampToValueAtTime(2850, t + 0.18);

    // Overtone Oscillator (Sine wave at ~3600 Hz with lower gain)
    const overtone = this.ctx.createOscillator();
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(3600, t);
    overtone.frequency.exponentialRampToValueAtTime(4250, t + 0.18);

    const overtoneGain = this.ctx.createGain();
    overtoneGain.gain.setValueAtTime(0.22, t);

    // Vibrato LFO at 17 Hz for characteristic whistle warble
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(17, t);
    lfoGain.gain.setValueAtTime(45, t); // 45 Hz frequency modulation depth

    lfo.connect(lfoGain);
    lfoGain.connect(carrier.frequency);

    // Master whistle gain envelope: fast attack (~0.02s), sustained pip (~0.18s), quick decay (~0.06s)
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(0, t);
    masterGain.gain.linearRampToValueAtTime(0.28, t + 0.02);
    masterGain.gain.setValueAtTime(0.28, t + 0.20);
    masterGain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    masterGain.gain.setValueAtTime(0, t + 0.27);

    // Routing
    carrier.connect(masterGain);
    overtone.connect(overtoneGain);
    overtoneGain.connect(masterGain);
    masterGain.connect(this.ctx.destination);

    // Start & stop nodes
    lfo.start(t);
    carrier.start(t);
    overtone.start(t);

    lfo.stop(t + 0.28);
    carrier.stop(t + 0.28);
    overtone.stop(t + 0.28);
  }

  // Tennis ball bounce pop
  playBallBounce() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.06);

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.09);
  }

  // Petting Chime
  playPet() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + idx * 0.05);

      gain.gain.setValueAtTime(0.12, t + idx * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.05 + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t + idx * 0.05);
      osc.stop(t + idx * 0.05 + 0.26);
    });
  }

  // Soft grass footstep rustle
  playFootstep() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const bufferSize = this.ctx.sampleRate * 0.04;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.3;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900 + Math.random() * 200, t);
    filter.Q.setValueAtTime(2.0, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start(t);
  }

  // Authentic British Birdsong Variety:
  // Blackbird: Melodic flute-like whistles sweeping 1800 Hz to 2600 Hz in expressive 2-3 note motifs
  playBlackbird() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    // 2 to 3 note motif
    const noteCount = Math.random() < 0.5 ? 2 : 3;
    const motifNotes = [
      { startFreq: 1850 + Math.random() * 200, endFreq: 2400 + Math.random() * 200, dur: 0.16 },
      { startFreq: 2300 + Math.random() * 200, endFreq: 2000 + Math.random() * 150, dur: 0.18 },
      { startFreq: 2100 + Math.random() * 200, endFreq: 2550 + Math.random() * 100, dur: 0.22 }
    ];

    let noteOffset = 0;
    for (let i = 0; i < noteCount; i++) {
      const note = motifNotes[i];
      const startT = t + noteOffset;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.startFreq, startT);
      osc.frequency.exponentialRampToValueAtTime(note.endFreq, startT + note.dur * 0.85);

      gain.gain.setValueAtTime(0, startT);
      gain.gain.linearRampToValueAtTime(0.045, startT + 0.02);
      gain.gain.setValueAtTime(0.04, startT + note.dur * 0.7);
      gain.gain.exponentialRampToValueAtTime(0.001, startT + note.dur);
      gain.gain.setValueAtTime(0, startT + note.dur + 0.01);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startT);
      osc.stop(startT + note.dur + 0.02);

      noteOffset += note.dur + 0.06 + Math.random() * 0.04;
    }
  }

  // European Robin: High-frequency crystalline trills (3200 Hz to 4200 Hz with fast vibrato modulation)
  playRobin() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const trillDuration = 0.24 + Math.random() * 0.08;
    const baseFreq = 3400 + Math.random() * 500; // 3400 - 3900 Hz

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.linearRampToValueAtTime(Math.min(4200, baseFreq + 300), t + trillDuration);

    // Fast vibrato modulation (~28-35 Hz)
    const vibrato = this.ctx.createOscillator();
    const vibratoGain = this.ctx.createGain();
    vibrato.type = 'sine';
    vibrato.frequency.setValueAtTime(32, t);
    vibratoGain.gain.setValueAtTime(120, t); // modulation depth in Hz

    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.035, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + trillDuration);
    gain.gain.setValueAtTime(0, t + trillDuration + 0.01);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    vibrato.start(t);
    osc.start(t);

    vibrato.stop(t + trillDuration + 0.02);
    osc.stop(t + trillDuration + 0.02);
  }

  // Woodpigeon: Gentle, low-frequency rhythmic cooing (two warm rounded pulses around 380-420 Hz)
  playWoodpigeon() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const pulses = [
      { start: 0, dur: 0.22, freq: 390 },
      { start: 0.28, dur: 0.32, freq: 410 }
    ];

    pulses.forEach(p => {
      const pulseT = t + p.start;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.freq, pulseT);
      osc.frequency.linearRampToValueAtTime(p.freq - 15, pulseT + p.dur);

      gain.gain.setValueAtTime(0, pulseT);
      gain.gain.linearRampToValueAtTime(0.04, pulseT + 0.05);
      gain.gain.setValueAtTime(0.035, pulseT + p.dur * 0.6);
      gain.gain.exponentialRampToValueAtTime(0.001, pulseT + p.dur);
      gain.gain.setValueAtTime(0, pulseT + p.dur + 0.01);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(pulseT);
      osc.stop(pulseT + p.dur + 0.02);
    });
  }

  // Intermittent birdsong in the trees - randomly selects among authentic British species
  playBirdChirp() {
    this.ensureContext();
    if (!this.ctx || this.isMuted) return;

    const r = Math.random();
    if (r < 0.40) {
      this.playBlackbird();
    } else if (r < 0.75) {
      this.playRobin();
    } else {
      this.playWoodpigeon();
    }
  }

  // Background Breeze in the trees:
  // Breathing canopy wind with dual-filter low-pass pink noise swept by slow sinusoidal LFO (period ~10s, 260 Hz to 440 Hz)
  startAmbientBreeze() {
    if (this.ambientStarted) return;
    this.ensureContext();
    if (!this.ctx) return;
    this.ambientStarted = true;

    try {
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99 * b0 + white * 0.05;
        b1 = 0.95 * b1 + white * 0.05;
        b2 = 0.85 * b2 + white * 0.05;
        data[i] = (b0 + b1 + b2) * 0.2;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      // Dual-filter low-pass configuration for organic canopy acoustics
      const filter1 = this.ctx.createBiquadFilter();
      filter1.type = 'lowpass';
      filter1.frequency.setValueAtTime(350, this.ctx.currentTime);
      filter1.Q.setValueAtTime(1.0, this.ctx.currentTime);

      const filter2 = this.ctx.createBiquadFilter();
      filter2.type = 'lowpass';
      filter2.frequency.setValueAtTime(350, this.ctx.currentTime);
      filter2.Q.setValueAtTime(0.7, this.ctx.currentTime);

      // Slow sinusoidal LFO (period ~10s -> 0.1 Hz) gently sweeping filter cutoffs between 260 Hz and 440 Hz
      // Base frequency = 350 Hz, modulation depth = 90 Hz (350 - 90 = 260 Hz, 350 + 90 = 440 Hz)
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.1, this.ctx.currentTime); // 10 second period

      const lfoGain1 = this.ctx.createGain();
      lfoGain1.gain.setValueAtTime(90, this.ctx.currentTime);
      lfo.connect(lfoGain1);
      lfoGain1.connect(filter1.frequency);

      const lfoGain2 = this.ctx.createGain();
      lfoGain2.gain.setValueAtTime(90, this.ctx.currentTime);
      lfo.connect(lfoGain2);
      lfoGain2.connect(filter2.frequency);

      // Smooth gain transition ensuring relaxing, non-intrusive background presence (gain ~0.035)
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.035, this.ctx.currentTime + 3.0);

      // Audio routing: noise -> filter1 -> filter2 -> gain -> destination
      noise.connect(filter1);
      filter1.connect(filter2);
      filter2.connect(gain);
      gain.connect(this.ctx.destination);

      lfo.start();
      noise.start();
      this.breezeNode = gain;

      // Schedule occasional authentic British birdsong with weather/diurnal modulation
      setInterval(() => {
        if (this.isMuted) return;

        // At NIGHT: birdsong is silent
        if (this.currentTimeOfDay === 'NIGHT') return;

        // Weather bird chirp suppression:
        // If weather is RAIN: bird chirps are paused or suppressed (birds shelter during heavy rain)
        if (this.currentWeather === 'RAIN') return;

        // Base probability is 0.45
        // If weather is DRIZZLE or FOG: bird chirp frequency is halved
        let prob = 0.45;
        if (this.currentWeather === 'DRIZZLE' || this.currentWeather === 'FOG') {
          prob *= 0.5;
        }

        if (Math.random() < prob) {
          this.playBirdChirp();
        }
      }, 4000);

      // Initialize rain synth graph if context exists
      this._initRainSynthesizer();

      // Start periodic wind gust / thunder rumble scheduler for precipitation
      if (!this.weatherTimer) {
        this.weatherTimer = setInterval(() => {
          if (this.isMuted || !this.ctx || this.ctx.state === 'suspended') return;
          if (this.currentWeather === 'RAIN') {
            if (Math.random() < 0.35) {
              this.playThunderRumble();
            } else if (Math.random() < 0.5) {
              this.playWindGust();
            }
          } else if (this.currentWeather === 'DRIZZLE' && Math.random() < 0.25) {
            this.playWindGust();
          }
        }, 12000);
      }
    } catch (e) {
      console.warn('Ambient audio could not start:', e);
    }
  }

  // Procedural Rain Synthesizer Graph
  _initRainSynthesizer() {
    if (!this.ctx || this.rainSource) return;

    try {
      // Pink / white noise buffer loop (3 seconds)
      const bufferSize = this.ctx.sampleRate * 3;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + white * 0.5362) * 0.1;
      }

      this.rainSource = this.ctx.createBufferSource();
      this.rainSource.buffer = buffer;
      this.rainSource.loop = true;

      // Dual-filter bandpass / lowpass filtering shaping noise into falling precipitation on park foliage and grass
      this.rainLowpassFilter = this.ctx.createBiquadFilter();
      this.rainLowpassFilter.type = 'lowpass';
      this.rainLowpassFilter.frequency.setValueAtTime(2000, this.ctx.currentTime);
      this.rainLowpassFilter.Q.setValueAtTime(1.0, this.ctx.currentTime);

      this.rainBandpassFilter = this.ctx.createBiquadFilter();
      this.rainBandpassFilter.type = 'bandpass';
      this.rainBandpassFilter.frequency.setValueAtTime(1600, this.ctx.currentTime);
      this.rainBandpassFilter.Q.setValueAtTime(0.8, this.ctx.currentTime);

      this.rainGainNode = this.ctx.createGain();
      this.rainGainNode.gain.setValueAtTime(0.0001, this.ctx.currentTime);

      // Connect: noise -> bandpass -> lowpass -> rainGainNode -> destination
      this.rainSource.connect(this.rainBandpassFilter);
      this.rainBandpassFilter.connect(this.rainLowpassFilter);
      this.rainLowpassFilter.connect(this.rainGainNode);
      this.rainGainNode.connect(this.ctx.destination);

      this.rainSource.start();
    } catch (e) {
      console.warn('Rain audio synthesizer could not be initialized:', e);
    }
  }

  // Low-frequency thunder rumble for rain / heavy squalls (swept 60 Hz to 180 Hz)
  playThunderRumble() {
    this.ensureContext();
    if (!this.ctx || this.isMuted || this.ctx.state === 'suspended') return;

    try {
      const t = this.ctx.currentTime;
      const duration = 3.5 + Math.random() * 1.5;
      const bufferSize = Math.floor(this.ctx.sampleRate * duration);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        // Low-frequency brownian rumble noise
        lastOut = (lastOut + 0.02 * white) / 1.02;
        data[i] = lastOut * 3.5;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      // Lowpass filter swept between 60 Hz and 180 Hz
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(75, t);
      filter.frequency.exponentialRampToValueAtTime(160, t + 0.8);
      filter.frequency.exponentialRampToValueAtTime(65, t + duration);
      filter.Q.setValueAtTime(2.5, t);

      // Subtle LFO modulation sweeping filter cutoffs in the 60-180 Hz range
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.35, t);
      lfoGain.gain.setValueAtTime(35, t);
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      // Gain envelope: gentle ambient volume (~0.04) so it remains soothing and immersive
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.04, t + 0.9);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      lfo.start(t);
      noise.start(t);

      lfo.stop(t + duration);
      noise.stop(t + duration);
    } catch (e) {
      console.warn('Thunder rumble could not play:', e);
    }
  }

  // Surging wind gusts during precipitation or squalls
  playWindGust() {
    this.ensureContext();
    if (!this.ctx || this.isMuted || this.ctx.state === 'suspended') return;

    try {
      const t = this.ctx.currentTime;
      const duration = 4.0;
      const bufferSize = Math.floor(this.ctx.sampleRate * duration);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.98 * b0 + white * 0.08;
        b1 = 0.95 * b1 + white * 0.08;
        data[i] = (b0 + b1) * 0.5;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      // Lowpass filter modulated between 120 Hz and 320 Hz
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, t);
      filter.frequency.linearRampToValueAtTime(280, t + 1.8);
      filter.frequency.linearRampToValueAtTime(110, t + duration);
      filter.Q.setValueAtTime(1.8, t);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.032, t + 1.6);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      noise.start(t);
      noise.stop(t + duration);
    } catch (e) {
      console.warn('Wind gust could not play:', e);
    }
  }

  // Weather soundscape modulation:
  // - Updates internal currentWeather property
  // - Adjusts rain synthesizer and breeze node volume
  // - Controls birdsong suppression / attenuation
  setWeather(weatherType) {
    const validWeather = (weatherType || '').toUpperCase();
    this.currentWeather = validWeather;

    if (!this.ctx || this.ctx.state === 'suspended') return;

    // Ensure rain synthesizer graph exists
    if (!this.rainSource) {
      this._initRainSynthesizer();
    }

    if (!this.rainGainNode) return;

    const t = this.ctx.currentTime;
    // Cancel any scheduled transitions
    this.rainGainNode.gain.cancelScheduledValues(t);

    if (validWeather === 'DRIZZLE') {
      // Light rain / drizzle: higher cutoff frequency (~1800 Hz) with gentle low gain (~0.02)
      if (this.rainLowpassFilter) {
        this.rainLowpassFilter.frequency.cancelScheduledValues(t);
        this.rainLowpassFilter.frequency.linearRampToValueAtTime(1800, t + 1.5);
      }
      if (this.rainBandpassFilter) {
        this.rainBandpassFilter.frequency.cancelScheduledValues(t);
        this.rainBandpassFilter.frequency.linearRampToValueAtTime(1400, t + 1.5);
      }
      const targetGain = this.isMuted ? 0.0001 : 0.02;
      this.rainGainNode.gain.linearRampToValueAtTime(targetGain, t + 1.5);

      // Breeze volume modulation
      if (this.breezeNode) {
        this.breezeNode.gain.cancelScheduledValues(t);
        this.breezeNode.gain.linearRampToValueAtTime(this.isMuted ? 0.0001 : 0.038, t + 1.5);
      }
    } else if (validWeather === 'RAIN') {
      // Moderate / heavy rain: broader frequency spectrum (lowpass ~2400 Hz) with richer resonance and gain (~0.05)
      if (this.rainLowpassFilter) {
        this.rainLowpassFilter.frequency.cancelScheduledValues(t);
        this.rainLowpassFilter.frequency.linearRampToValueAtTime(2400, t + 2.0);
      }
      if (this.rainBandpassFilter) {
        this.rainBandpassFilter.frequency.cancelScheduledValues(t);
        this.rainBandpassFilter.frequency.linearRampToValueAtTime(1800, t + 2.0);
      }
      const targetGain = this.isMuted ? 0.0001 : 0.05;
      this.rainGainNode.gain.linearRampToValueAtTime(targetGain, t + 2.0);

      // In heavy rain, increase breeze gain slightly for stormy rustle
      if (this.breezeNode) {
        this.breezeNode.gain.cancelScheduledValues(t);
        this.breezeNode.gain.linearRampToValueAtTime(this.isMuted ? 0.0001 : 0.045, t + 2.0);
      }
    } else {
      // CLEAR, OVERCAST, or FOG: smoothly ramp rain gain down to 0 over 2 seconds
      this.rainGainNode.gain.linearRampToValueAtTime(0.0001, t + 2.0);

      // Restore normal canopy breeze gain based on diurnal state
      if (this.breezeNode) {
        const defaultBreezeGain = this.currentTimeOfDay === 'NIGHT' ? 0.015 : 0.035;
        this.breezeNode.gain.cancelScheduledValues(t);
        this.breezeNode.gain.linearRampToValueAtTime(this.isMuted ? 0.0001 : defaultBreezeGain, t + 2.0);
      }
    }
  }

  // Diurnal soundscape modulation:
  // - timeState: 'DAWN', 'DAY', 'GOLDEN_HOUR', 'DUSK', 'NIGHT'
  // - At NIGHT: birdsong is silent; ambient canopy breeze gain is lowered to a quiet, soothing night rustle (~0.015)
  // - At DAWN / DAY: birdsong interval is active
  setTimeOfDay(timeState) {
    const validTime = (timeState || '').toUpperCase();
    this.currentTimeOfDay = validTime;

    if (!this.ctx || this.ctx.state === 'suspended' || !this.breezeNode) return;

    const t = this.ctx.currentTime;
    this.breezeNode.gain.cancelScheduledValues(t);

    if (this.isMuted) {
      this.breezeNode.gain.linearRampToValueAtTime(0.0001, t + 1.0);
      return;
    }

    if (validTime === 'NIGHT') {
      // Night rustle: ~0.015
      this.breezeNode.gain.linearRampToValueAtTime(0.015, t + 2.5);
    } else if (validTime === 'DUSK' || validTime === 'GOLDEN_HOUR') {
      // Twilight gentle rustle: ~0.028
      this.breezeNode.gain.linearRampToValueAtTime(0.028, t + 2.5);
    } else {
      // DAWN / DAY active breeze: ~0.035
      // If it is currently raining, preserve rain storm breeze
      const dayBreezeGain = this.currentWeather === 'RAIN' ? 0.045 : 0.035;
      this.breezeNode.gain.linearRampToValueAtTime(dayBreezeGain, t + 2.5);
    }
  }
}

export const sound = new SoundSynthesizer();
