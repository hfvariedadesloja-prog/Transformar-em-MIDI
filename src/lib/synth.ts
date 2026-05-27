/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

class SynthEngine {
  private ctx: AudioContext | null = null;
  private mainGain: GainNode | null = null;
  // Spatial stereo wash
  private reverbLeft: DelayNode | null = null;
  private reverbRight: DelayNode | null = null;
  private reverbFeedbackLeft: GainNode | null = null;
  private reverbFeedbackRight: GainNode | null = null;
  private reverbFilterLeft: BiquadFilterNode | null = null;
  private reverbFilterRight: BiquadFilterNode | null = null;

  // Track active oscillators and nodes for handling clean release
  private activeOscillators: {
    [pitch: number]: Array<{
      nodes: AudioNode[];
      gainNode: GainNode;
    }>;
  } = {};

  constructor() {}

  private initCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Main master volume limiter
      this.mainGain = this.ctx.createGain();
      this.mainGain.gain.setValueAtTime(0.85, this.ctx.currentTime);
      this.mainGain.connect(this.ctx.destination);

      // Create a gorgeous stereophonic spatial reverb utilizing dual-cross-delay feedback loops (LCR wash)
      try {
        const timeL = 0.350; // 350ms left delay
        const timeR = 0.470; // 470ms right delay (asymmetric for stereo widening)

        this.reverbLeft = this.ctx.createDelay(1.5);
        this.reverbRight = this.ctx.createDelay(1.5);
        this.reverbLeft.delayTime.setValueAtTime(timeL, this.ctx.currentTime);
        this.reverbRight.delayTime.setValueAtTime(timeR, this.ctx.currentTime);

        this.reverbFeedbackLeft = this.ctx.createGain();
        this.reverbFeedbackRight = this.ctx.createGain();
        // Generous feedback tail for cathedral-like piano wash
        this.reverbFeedbackLeft.gain.setValueAtTime(0.48, this.ctx.currentTime);
        this.reverbFeedbackRight.gain.setValueAtTime(0.48, this.ctx.currentTime);

        // Low-pass filters to make the echoes dark and warm, cutting off digital high-frequency squeaks
        this.reverbFilterLeft = this.ctx.createBiquadFilter();
        this.reverbFilterRight = this.ctx.createBiquadFilter();
        this.reverbFilterLeft.type = 'lowpass';
        this.reverbFilterRight.type = 'lowpass';
        this.reverbFilterLeft.frequency.setValueAtTime(850, this.ctx.currentTime);
        this.reverbFilterRight.frequency.setValueAtTime(800, this.ctx.currentTime);

        // Standard Stereo Panning for the split delays
        const panL = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
        const panR = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
        if (panL) panL.pan.setValueAtTime(-0.8, this.ctx.currentTime);
        if (panR) panR.pan.setValueAtTime(0.8, this.ctx.currentTime);

        // Map feedback paths (with cross-coupling to create lush diffusions)
        this.mainGain.connect(this.reverbLeft);
        this.mainGain.connect(this.reverbRight);

        this.reverbLeft.connect(this.reverbFilterLeft);
        this.reverbRight.connect(this.reverbFilterRight);

        this.reverbFilterLeft.connect(this.reverbFeedbackLeft);
        this.reverbFilterRight.connect(this.reverbFeedbackRight);

        // Cross feedback
        this.reverbFeedbackLeft.connect(this.reverbRight);
        this.reverbFeedbackRight.connect(this.reverbLeft);

        // Output connections
        if (panL && panR) {
          this.reverbFeedbackLeft.connect(panL);
          this.reverbFeedbackRight.connect(panR);
          panL.connect(this.ctx.destination);
          panR.connect(this.ctx.destination);
        } else {
          this.reverbFeedbackLeft.connect(this.ctx.destination);
          this.reverbFeedbackRight.connect(this.ctx.destination);
        }
      } catch (err) {
        console.warn('Reverb engine initialization failed, running in dry mode:', err);
      }
    }
    
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Play a beautifully enriched additive grand piano/synthesizer keyboard voice
   */
  public playNote(
    pitch: number,
    type: 'sine' | 'square' | 'sawtooth' | 'triangle' = 'triangle',
    velocity = 80
  ) {
    try {
      this.initCtx();
      if (!this.ctx) return;

      // Stop any existing note at same pitch
      this.stopNote(pitch);

      const freq = 440 * Math.pow(2, (pitch - 69) / 12);
      const now = this.ctx.currentTime;

      // 1. Stereo soundstage panning based on keyboard layout (Bass left, Treble right)
      const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (panner) {
        // Map MIDI 21 to 108 to PAN range [-0.4, 0.4]
        const panValue = ((pitch - 21) / (108 - 21)) * 0.8 - 0.4;
        panner.pan.setValueAtTime(panValue, now);
      }

      // Base nodes array to clean up on note stop
      const noteNodes: AudioNode[] = [];

      // 2. Harmonic Additive Engine (Fundamental + 2nd, 3rd, and 4th harmonics)
      // Standard Piano harmonic balances
      const osc1 = this.ctx.createOscillator(); // Fundamental (sine waves for warmth and structural clarity)
      const osc2 = this.ctx.createOscillator(); // 1st overtone (triangle)
      const osc3 = this.ctx.createOscillator(); // 2nd overtone (triangle/sine)
      const osc1Gain = this.ctx.createGain();
      const osc2Gain = this.ctx.createGain();
      const osc3Gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq, now);
      osc1Gain.gain.setValueAtTime(0.70, now);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(freq * 2, now);
      osc2Gain.gain.setValueAtTime(0.24, now);

      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(freq * 3, now);
      osc3Gain.gain.setValueAtTime(0.08, now);

      // Connect harmonic layers
      osc1.connect(osc1Gain);
      osc2.connect(osc2Gain);
      osc3.connect(osc3Gain);

      // 3. Hammer Hammer Strike Impulse (Emulates the physical strike of the keys with wood/felt)
      const hammer = this.ctx.createOscillator();
      const hammerGain = this.ctx.createGain();
      hammer.type = 'triangle';
      // High frequency pitch sweep for click sound
      hammer.frequency.setValueAtTime(freq * 8, now);
      hammer.frequency.exponentialRampToValueAtTime(freq, now + 0.024);
      hammerGain.gain.setValueAtTime(0.35 * (velocity / 127), now);
      hammerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022); // super fast decay

      hammer.connect(hammerGain);
      noteNodes.push(osc1, osc2, osc3, hammer);

      // 4. Lowpass Resonant Envelope filter (Emulates natural high-frequency soundboard damping)
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      
      const initialCutoff = Math.max(1600, freq * 4.5);
      const sustainCutoff = Math.max(400, freq * 1.05);
      filter.frequency.setValueAtTime(initialCutoff, now);
      // Sweeps down to damp upper harmonic buzz as note rings
      filter.frequency.exponentialRampToValueAtTime(sustainCutoff, now + 0.45);
      filter.Q.setValueAtTime(1.2, now);

      // Connect individual generators to filter
      const blendGain = this.ctx.createGain();
      blendGain.gain.setValueAtTime(1.0, now);
      
      osc1Gain.connect(blendGain);
      osc2Gain.connect(blendGain);
      osc3Gain.connect(blendGain);
      hammerGain.connect(blendGain);

      blendGain.connect(filter);
      noteNodes.push(osc1Gain, osc2Gain, osc3Gain, hammerGain, blendGain, filter);

      // 5. Tone Amplitude ADSR Envelope
      const noteGain = this.ctx.createGain();
      // Safe maximum target amplitude
      const maxVolume = (velocity / 127) * 0.16;
      
      noteGain.gain.setValueAtTime(0, now);
      // Soft touch attack curve (eliminates synthetic clicking)
      noteGain.gain.linearRampToValueAtTime(maxVolume, now + 0.028);
      // Smooth natural decay for a warm keyboard body ring
      noteGain.gain.setValueAtTime(maxVolume, now + 0.028);
      noteGain.gain.exponentialRampToValueAtTime(maxVolume * 0.28, now + 2.5);

      if (panner) {
        filter.connect(panner);
        panner.connect(noteGain);
        noteNodes.push(panner);
      } else {
        filter.connect(noteGain);
      }

      noteGain.connect(this.mainGain || this.ctx.destination);
      noteNodes.push(noteGain);

      // Launch all voices
      osc1.start(now);
      osc2.start(now);
      osc3.start(now);
      hammer.start(now);

      if (!this.activeOscillators[pitch]) {
        this.activeOscillators[pitch] = [];
      }
      this.activeOscillators[pitch].push({
        nodes: noteNodes,
        gainNode: noteGain
      });
    } catch (e) {
      console.error('Falha do som ao inicializar osciladores:', e);
    }
  }

  /**
   * Release a playing note smoothly, simulating keyboard dampers returning to strings
   */
  public stopNote(pitch: number) {
    try {
      if (!this.ctx || !this.activeOscillators[pitch]) return;

      const list = this.activeOscillators[pitch];
      const now = this.ctx.currentTime;

      list.forEach(({ nodes, gainNode }) => {
        try {
          // Soft damper release sweep (420ms keeps a gorgeous trailing body chime)
          gainNode.gain.cancelScheduledValues(now);
          gainNode.gain.setValueAtTime(gainNode.gain.value, now);
          gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
          
          setTimeout(() => {
            try {
              // Disconnect and stop all nodes to release memory and CPU cycles
              nodes.forEach((node) => {
                try {
                  if ('stop' in node) {
                    (node as any).stop();
                  }
                  node.disconnect();
                } catch (err) {}
              });
            } catch (err) {}
          }, 500);
        } catch (err) {}
      });

      delete this.activeOscillators[pitch];
    } catch (e) {
      console.error('Falha ao parar tom do sintetizador:', e);
    }
  }

  /**
   * Stop all sounding piano notes simultaneously
   */
  public stopAll() {
    Object.keys(this.activeOscillators).forEach((pitch) => {
      this.stopNote(Number(pitch));
    });
  }
}

export const pSynth = new SynthEngine();
export default pSynth;
