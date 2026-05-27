/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MidiNoteEvent {
  id: string;
  pitch: number;      // MIDI note number (21 - 108)
  startTime: number;  // Start time in seconds
  endTime: number;    // End time in seconds
  velocity: number;   // Calculated volume (0 - 127)
}

export type TranscriptionMode = 'monophonic' | 'polyphonic';
export type QuantizeValue = 'none' | '1/4' | '1/8' | '1/16' | '1/32';

export interface TranscriptionSettings {
  mode: TranscriptionMode;
  noiseGate: number;       // Silent threshold (0.01 - 0.20)
  sensitivity: number;     // Trigger threshold (0.01 - 0.50)
  minNoteDuration: number; // In seconds (0.03 - 0.50)
  harmonicFilter: number;  // Harmonic suppression coefficient (0.0 - 1.0)
  bpm: number;             // Tempo in Beats per Minute (60 - 240)
  quantize: QuantizeValue; // Rhythm quantization level
}

export interface AudioFileData {
  name: string;
  size: number;
  duration: number;
  sampleRate: number;
  buffer: AudioBuffer;
}
