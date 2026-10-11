// Procedural Web Audio API Sound Synthesizer & Clifton Down Ambient Nature Engine

class SoundSynthesizer {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.ambientStarted = false;
    this.breezeNode = null;
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

      // Schedule occasional authentic British birdsong
      setInterval(() => {
        if (Math.random() < 0.45 && !this.isMuted) {
          this.playBirdChirp();
        }
      }, 4000);
    } catch (e) {
      console.warn('Ambient audio could not start:', e);
    }
  }
}

export const sound = new SoundSynthesizer();
