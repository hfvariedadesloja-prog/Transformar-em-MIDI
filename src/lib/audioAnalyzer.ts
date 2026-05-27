/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MidiNoteEvent, TranscriptionSettings } from '../types';

/**
 * Standard MIDI pitch numbers have mapping:
 * Note name = key + 21
 * Key 0 = A0 (MIDI 21)
 * Key 87 = C8 (MIDI 108)
 */
const MIDI_MIN_PITCH = 21;
const MIDI_MAX_PITCH = 108;
const NUM_PIANO_KEYS = 88;

/**
 * Robust Monophonic Pitch Detection using a variation of the YIN algorithm.
 * Excellent for vocal solos or individual melody lines.
 */
function detectMonophonicPitchYIN(
  signal: Float32Array,
  startIdx: number,
  N: number,
  sampleRate: number
): number {
  // We want to scan frequencies from A0 (27.5 Hz) up to C8 (4186 Hz).
  // Lag tau = SampleRate / Frequency
  // Minimum frequency of 27.5 Hz -> max lag of sampleRate / 27.5 (~1600 samples)
  // Maximum frequency of 2500 Hz -> min lag of sampleRate / 2000 (~22 samples)
  const maxLag = Math.min(N - 1, Math.floor(sampleRate / 27.5));
  const minLag = Math.floor(sampleRate / 2500);
  
  const d = new Float32Array(maxLag);
  
  // Step 1: Difference function
  for (let tau = 1; tau < maxLag; tau++) {
    let sum = 0;
    for (let n = 0; n < N - tau; n++) {
      const idx1 = startIdx + n;
      const idx2 = startIdx + n + tau;
      if (idx2 >= signal.length) break;
      const diff = signal[idx1] - signal[idx2];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  
  // Step 2: Cumulative mean normalized difference function
  const dPrime = new Float32Array(maxLag);
  dPrime[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < maxLag; tau++) {
    runningSum += d[tau];
    if (runningSum === 0) {
      dPrime[tau] = 1;
    } else {
      dPrime[tau] = d[tau] / ((1 / tau) * runningSum);
    }
  }
  
  // Step 3: Absolute threshold selection
  const threshold = 0.15;
  let bestTau = -1;
  
  // Find first local minimum that stays below threshold
  for (let tau = minLag; tau < maxLag; tau++) {
    if (dPrime[tau] < threshold) {
      // Check if it's a local minimum
      if (tau + 1 < maxLag && dPrime[tau] < dPrime[tau - 1] && dPrime[tau] < dPrime[tau + 1]) {
        bestTau = tau;
        break;
      }
    }
  }
  
  // Fallback to global minimum if no local minimum qualified
  if (bestTau === -1) {
    let minVal = 999;
    for (let tau = minLag; tau < maxLag; tau++) {
      if (dPrime[tau] < minVal) {
        minVal = dPrime[tau];
        bestTau = tau;
      }
    }
    // If the global minimum is too noisy, consider it silence
    if (minVal > 0.4) {
      return 0;
    }
  }
  
  if (bestTau > 0) {
    const freq = sampleRate / bestTau;
    if (freq >= 20 && freq <= 4500) {
      // Convert frequency to MIDI
      // p = 12 * log2(f / 440) + 69
      const midiFloat = 12 * Math.log2(freq / 440) + 69;
      return midiFloat;
    }
  }
  
  return 0;
}

/**
 * Main transcription service
 */
export async function transcribeAudio(
  audioBuffer: AudioBuffer,
  settings: TranscriptionSettings,
  onProgress: (percent: number, status: string) => void
): Promise<MidiNoteEvent[]> {
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  
  onProgress(5, 'Pré-processando áudio...') ;
  
  // 1. Blend stereo channels into single Mono channel
  const numChannels = audioBuffer.numberOfChannels;
  let mono: Float32Array;
  
  if (numChannels === 1) {
    mono = audioBuffer.getChannelData(0);
  } else {
    // Standard audio blending
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) {
      mono[i] = (left[i] + right[i]) * 0.5;
    }
  }
  
  // 2. Setup Frames & Windowing
  // Frame size of 4096 samples provides excellent base selectivity (10.7Hz)
  // Hop size of 1024 corresponds to 23.2ms updates at 44.1kHz
  const N = 4096;
  const hopSize = 1024;
  const totalSamples = mono.length;
  const framesCount = Math.floor((totalSamples - N) / hopSize) + 1;
  const timeStep = hopSize / sampleRate; // Time duration of one frame delta
  
  onProgress(15, 'Construindo filtros harmônicos...');
  
  // Pre-calculate Hanning window
  const hanningWindow = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    hanningWindow[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
  }
  
  // Precompile Direct DFT Goertzel-like Trigonometric matrices for optimal 88 keys
  const pianoFrequencies = new Float32Array(NUM_PIANO_KEYS);
  const cosMatrix: Float32Array[] = [];
  const sinMatrix: Float32Array[] = [];
  
  for (let k = 0; k < NUM_PIANO_KEYS; k++) {
    const midiPitch = k + MIDI_MIN_PITCH;
    // Freq formula
    const freq = 440 * Math.pow(2, (midiPitch - 69) / 12);
    pianoFrequencies[k] = freq;
    
    const cosArray = new Float32Array(N);
    const sinArray = new Float32Array(N);
    const radiansFactor = (2 * Math.PI * freq) / sampleRate;
    
    for (let n = 0; n < N; n++) {
      // Multiply sine/cosine by Hanning window pre-hand to save multiplications inside runtime loop!
      cosArray[n] = Math.cos(n * radiansFactor) * hanningWindow[n];
      sinArray[n] = Math.sin(n * radiansFactor) * hanningWindow[n];
    }
    
    cosMatrix.push(cosArray);
    sinMatrix.push(sinArray);
  }
  
  // 3. Process each frame
  const framesMagnitudes: Float32Array[] = [];
  
  onProgress(25, 'Decodificando ondas espectrais...');
  
  // Process in non-blocking batches to enable GUI rendering during analysis
  const batchSize = Math.max(20, Math.floor(framesCount / 40));
  
  for (let f = 0; f < framesCount; f++) {
    const offset = f * hopSize;
    const magnitudes = new Float32Array(NUM_PIANO_KEYS);
    
    if (settings.mode === 'polyphonic') {
      // POLYPHONIC DFT DETECTOR
      for (let k = 0; k < NUM_PIANO_KEYS; k++) {
        let real = 0;
        let imag = 0;
        const cosK = cosMatrix[k];
        const sinK = sinMatrix[k];
        
        for (let n = 0; n < N; n++) {
          const sample = mono[offset + n] || 0;
          real += sample * cosK[n];
          imag += sample * sinK[n];
        }
        
        // Amplitude magnitude (scaled by size)
        magnitudes[k] = Math.sqrt(real * real + imag * imag) / (N * 0.25);
      }
      
      // Subharmonic suppression to prevent octave replication
      const filterCoeff = settings.harmonicFilter;
      if (filterCoeff > 0.01) {
        // Suppress octaves from low register to high
        for (let k = 0; k < NUM_PIANO_KEYS; k++) {
          const mag = magnitudes[k];
          if (mag > settings.noiseGate) {
            // Octave harmonic index (12 semitones up)
            if (k + 12 < NUM_PIANO_KEYS) {
              magnitudes[k + 12] = Math.max(0, magnitudes[k + 12] - mag * filterCoeff * 0.6);
            }
            // 5th harmonic index (19 semitones up)
            if (k + 19 < NUM_PIANO_KEYS) {
              magnitudes[k + 19] = Math.max(0, magnitudes[k + 19] - mag * filterCoeff * 0.4);
            }
            // 2nd octave harmonic index (24 semitones up)
            if (k + 24 < NUM_PIANO_KEYS) {
              magnitudes[k + 24] = Math.max(0, magnitudes[k + 24] - mag * filterCoeff * 0.3);
            }
          }
        }
      }
    } else {
      // MONOPHONIC YIN DETECTOR
      const pitchFloat = detectMonophonicPitchYIN(mono, offset, N, sampleRate);
      if (pitchFloat >= MIDI_MIN_PITCH && pitchFloat <= MIDI_MAX_PITCH) {
        // Calculate dynamic energy of frame to ensure it passes gating
        let energySum = 0;
        for (let n = 0; n < N; n++) {
          const sample = mono[offset + n] || 0;
          energySum += sample * sample;
        }
        const rms = Math.sqrt(energySum / N);
        
        if (rms > settings.noiseGate * 0.4) {
          const pitchInt = Math.round(pitchFloat);
          const idx = pitchInt - MIDI_MIN_PITCH;
          if (idx >= 0 && idx < NUM_PIANO_KEYS) {
            magnitudes[idx] = rms * 2.5; // Scale RMS to match spectrum amplitude ranges
          }
        }
      }
    }
    
    framesMagnitudes.push(magnitudes);
    
    // Periodically update progress to keep GUI fully fluid
    if (f % batchSize === 0 || f === framesCount - 1) {
      const completionPercent = 25 + Math.round((f / framesCount) * 55);
      onProgress(completionPercent, `Analisando frequências (${f}/${framesCount} blocos)...`);
      // Yield thread
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
  
  onProgress(85, 'Interpretando eventos e notas MIDI...');
  
  // 4. Temporal Integration - Convert frame magnitudes into start/end note intervals
  const rawEvents: MidiNoteEvent[] = [];
  
  // Track continuous states for each piano key modeled after Basic Pitch's onset-frame decoupling
  interface NoteState {
    isActive: boolean;
    onsetIndex: number; // frame index where note started
    maxVelocity: number; // Peak amplitude at onset
    frameCount: number;
  }
  
  const states: NoteState[] = Array.from({ length: NUM_PIANO_KEYS }, () => ({
    isActive: false,
    onsetIndex: -1,
    maxVelocity: 0,
    frameCount: 0
  }));
  
  // Loop keys and search chronological frames
  for (let k = 0; k < NUM_PIANO_KEYS; k++) {
    const pitch = k + MIDI_MIN_PITCH;
    
    for (let f = 0; f < framesCount; f++) {
      const mag = framesMagnitudes[f][k];
      const state = states[k];
      
      // Fine-tune responsive physical model thresholds based on piano registers
      // Low bass needs higher trigger gates to skip body rumble, and aggressive release curves
      let triggerThreshold = settings.sensitivity * 0.38;
      let releaseThreshold = settings.sensitivity * 0.16;
      
      if (pitch < 55) {
        triggerThreshold = settings.sensitivity * 0.60;
        releaseThreshold = settings.sensitivity * 0.44; // Sharp cutoff for low strings to end trailing rumble
      } else if (pitch < 72) {
        triggerThreshold = settings.sensitivity * 0.42;
        releaseThreshold = settings.sensitivity * 0.22;
      }
      
      // Track onset surging (Spotify Basic Pitch technology: look for sudden energy jumps)
      const lastMag = f > 0 ? framesMagnitudes[f - 1][k] : 0;
      const magChange = mag - lastMag;
      
      // Onset threshold ratios: low notes require steeper surge ratios because low waves bloom slowly
      const onsetRatio = pitch < 55 ? 1.40 : 1.25;
      const minDelta = pitch < 55 ? 0.015 : 0.006;
      
      const isOnset = f > 0
        ? (mag > triggerThreshold && mag > settings.noiseGate && mag > lastMag * onsetRatio && magChange > minDelta)
        : (mag > triggerThreshold && mag > settings.noiseGate);

      if (isOnset) {
        // If a note of same pitch is hit again (Double-strike / Arpeggios / pick repeats):
        // Close the previous active note event in the timeline and spawn a fresh one!
        if (state.isActive) {
          const durationFrames = f - state.onsetIndex;
          const durationSeconds = durationFrames * timeStep;
          
          const requiredMinDuration = pitch < 55
            ? Math.max(0.18, settings.minNoteDuration * 1.5)
            : settings.minNoteDuration;
            
          if (durationSeconds >= requiredMinDuration) {
            const velocity = Math.min(127, Math.max(30, Math.floor(state.maxVelocity * 1350)));
            
            // Advance low-notes in the midi file based on group delay to line up with treble notes exactly
            let noteStart = state.onsetIndex * timeStep;
            if (pitch < 38) {
              noteStart = Math.max(0, noteStart - 0.085);
            } else if (pitch < 55) {
              noteStart = Math.max(0, noteStart - 0.055);
            } else if (pitch < 70) {
              noteStart = Math.max(0, noteStart - 0.025);
            }
            
            rawEvents.push({
              id: `${pitch}-${state.onsetIndex}-${f}-${Math.random().toString(36).substr(2, 4)}`,
              pitch,
              startTime: noteStart,
              endTime: f * timeStep,
              velocity
            });
          }
        }
        
        // Initiate / Re-initiate state
        state.isActive = true;
        state.onsetIndex = f;
        state.maxVelocity = mag;
        state.frameCount = 1;
        
      } else if (state.isActive) {
        // Check for normal damping release
        if (mag < releaseThreshold || f === framesCount - 1) {
          const durationFrames = f - state.onsetIndex;
          const durationSeconds = durationFrames * timeStep;
          
          const requiredMinDuration = pitch < 55
            ? Math.max(0.18, settings.minNoteDuration * 1.5)
            : settings.minNoteDuration;
            
          if (durationSeconds >= requiredMinDuration) {
            const velocity = Math.min(127, Math.max(30, Math.floor(state.maxVelocity * 1350)));
            
            let noteStart = state.onsetIndex * timeStep;
            if (pitch < 38) {
              noteStart = Math.max(0, noteStart - 0.085);
            } else if (pitch < 55) {
              noteStart = Math.max(0, noteStart - 0.055);
            } else if (pitch < 70) {
              noteStart = Math.max(0, noteStart - 0.025);
            }
            
            rawEvents.push({
              id: `${pitch}-${state.onsetIndex}-${f}-${Math.random().toString(36).substr(2, 4)}`,
              pitch,
              startTime: noteStart,
              endTime: f * timeStep,
              velocity
            });
          }
          
          state.isActive = false;
          state.onsetIndex = -1;
          state.maxVelocity = 0;
          state.frameCount = 0;
        } else {
          // Note continues sounding, capture peak attack velocity and increment frame count
          state.maxVelocity = Math.max(state.maxVelocity, mag);
          state.frameCount++;
        }
      }
    }
  }
  
  onProgress(95, 'Polindo, sincronizando e aplicando quantização...');
  
  // 5. Quantize and refine notes
  let finalizedEvents = [...rawEvents];
  
  // Post-processing: Remove ultra-short isolated bass noise triggers (unlikely to be music notes)
  finalizedEvents = finalizedEvents.filter((note) => {
    const duration = note.endTime - note.startTime;
    if (note.pitch < 50 && duration < 0.12) {
      return false; // Skip glitchy low pedal/thump artifacts
    }
    return true;
  });
  
  if (settings.quantize !== 'none') {
    const beatDuration = 60 / settings.bpm; // duration of one beat in seconds
    
    let division = 1;
    switch (settings.quantize) {
      case '1/4': division = 1; break;
      case '1/8': division = 0.5; break;
      case '1/16': division = 0.25; break;
      case '1/32': division = 0.125; break;
    }
    
    const stepDuration = beatDuration * division;
    
    finalizedEvents = finalizedEvents.map((note) => {
      let qStart = Math.round(note.startTime / stepDuration) * stepDuration;
      let qEnd = Math.round(note.endTime / stepDuration) * stepDuration;
      
      // Edge cases: make sure note keeps at least size of 1 division steps
      if (qEnd <= qStart) {
        qEnd = qStart + stepDuration;
      }
      
      return {
        ...note,
        startTime: qStart,
        endTime: qEnd
      };
    });
  }
  
  // Clean up overlaps of same pitch by trimming early notes
  finalizedEvents.sort((a, b) => a.startTime - b.startTime);
  
  const pitchLastActiveMap = new Map<number, MidiNoteEvent>();
  
  finalizedEvents.forEach((note) => {
    const lastActiveNote = pitchLastActiveMap.get(note.pitch);
    if (lastActiveNote) {
      // If notes of same pitch overlap, shorten the previous note
      if (lastActiveNote.endTime > note.startTime) {
        lastActiveNote.endTime = Math.max(lastActiveNote.startTime + 0.05, note.startTime - 0.02);
      }
    }
    pitchLastActiveMap.set(note.pitch, note);
  });
  
  onProgress(100, 'Conversão concluída com sucesso!');
  
  return finalizedEvents;
}
