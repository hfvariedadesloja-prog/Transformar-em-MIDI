/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MidiNoteEvent } from '../types';

/**
 * Encodes a value as a MIDI Variable-Length Quantity (VLQ).
 * In VLQ, each byte uses the lower 7 bits for data, and the high bit
 * is set (1) if there are more bytes following, or clear (0) for the last byte.
 */
function encodeVLQ(value: number): number[] {
  const bytes: number[] = [];
  let buffer = Math.max(0, Math.floor(value));
  
  // The least significant byte is processed first (it will have bit 7 = 0)
  bytes.push(buffer & 0x7f);
  buffer = buffer >> 7;
  
  // Subsequent bytes have bit 7 = 1
  while (buffer > 0) {
    bytes.unshift((buffer & 0x7f) | 0x80);
    buffer = buffer >> 7;
  }
  
  return bytes;
}

/**
 * Converts a string to an array of ASCII character codes.
 */
function stringToBytes(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Keep within ASCII range
    bytes.push(code > 127 ? 32 : code);
  }
  return bytes;
}

/**
 * Standard MIDI file generation format 0 (single-track).
 * Creates a binary MIDI representation (.mid) from a list of note events.
 */
export function encodeMIDI(notes: MidiNoteEvent[], bpm: number): Uint8Array {
  const tpqn = 120; // Ticks Per Quarter Note (ticks per beat)
  
  // Convert notes to absolute tick events
  interface AbsoluteMidiEvent {
    tick: number;
    type: 'on' | 'off';
    pitch: number;
    velocity: number;
  }
  
  const absoluteEvents: AbsoluteMidiEvent[] = [];
  
  notes.forEach((note) => {
    // Math: Beats = TimeSeconds * (BPM / 60)
    // Ticks = Beats * TPQN
    const startBeat = note.startTime * (bpm / 60);
    const endBeat = note.endTime * (bpm / 60);
    
    const startTick = Math.round(startBeat * tpqn);
    const endTick = Math.round(endBeat * tpqn);
    
    // Simple verification to avoid infinitesimal durations
    const durationTicks = Math.max(1, endTick - startTick);
    
    // Safety boundaries for pitch
    const pitch = Math.max(21, Math.min(108, Math.floor(note.pitch)));
    const velocity = Math.max(1, Math.min(127, Math.floor(note.velocity)));
    
    absoluteEvents.push({
      tick: startTick,
      type: 'on',
      pitch,
      velocity
    });
    
    absoluteEvents.push({
      tick: startTick + durationTicks,
      type: 'off',
      pitch,
      velocity: 0 // Note Off can be represented as static Note On with velocity 0
    });
  });
  
  // Sort events chronologically.
  // CRITICAL nuance: If note-on and note-off land on the identical tick,
  // we want note-offs to happen FIRST so that we release preceding notes
  // before starting a new identical note, avoiding double-triggers.
  absoluteEvents.sort((a, b) => {
    if (a.tick !== b.tick) {
      return a.tick - b.tick;
    }
    if (a.type !== b.type) {
      return a.type === 'off' ? -1 : 1; // Off events first
    }
    return a.pitch - b.pitch;
  });
  
  // Create Track Data Bytes
  const trackData: number[] = [];
  
  // 1. Meta Event: Set Tempo
  // Delta time = 0
  trackData.push(...encodeVLQ(0));
  // Event: Meta (0xFF) + Tempo (0x51) + Length (3)
  trackData.push(0xff, 0x51, 0x03);
  // Microseconds per beat = 60,000,000 / BPM
  const microSecondsPerBeat = Math.round(60000000 / bpm);
  trackData.push(
    (microSecondsPerBeat >> 16) & 0xff,
    (microSecondsPerBeat >> 8) & 0xff,
    microSecondsPerBeat & 0xff
  );
  
  // 2. Meta Event: Track/Sequence Name
  const trackName = 'Audio para MIDI Piano';
  const trackNameBytes = stringToBytes(trackName);
  trackData.push(...encodeVLQ(0));
  trackData.push(0xff, 0x03);
  trackData.push(...encodeVLQ(trackNameBytes.length));
  trackData.push(...trackNameBytes);
  
  // 3. Write standard note events
  let lastTick = 0;
  
  absoluteEvents.forEach((event) => {
    const deltaTicks = event.tick - lastTick;
    lastTick = event.tick;
    
    // Write Delta Time as VLQ
    trackData.push(...encodeVLQ(deltaTicks));
    
    // Write MIDI status byte: 
    // We separate hands by MIDI Channel:
    // Right Hand (pitch >= 60) -> MIDI Channel 0 (Status 0x90)
    // Left Hand (pitch < 60) -> MIDI Channel 1 (Status 0x91)
    const channel = event.pitch < 60 ? 1 : 0;
    const statusByte = 0x90 + channel;
    
    if (event.type === 'on') {
      trackData.push(statusByte, event.pitch, event.velocity);
    } else {
      trackData.push(statusByte, event.pitch, 0); // Note Off is note-on on same channel with velocity 0
    }
  });
  
  // 4. Meta Event: End of Track
  // Delta time = 12 ticks after last event
  trackData.push(...encodeVLQ(12));
  trackData.push(0xff, 0x2f, 0x00);
  
  // Now, assemble the whole MIDI File Buffer
  // ----------------------------------------
  
  // MThd Header Chunk
  const headerBytes = [
    0x4d, 0x54, 0x68, 0x64, // 'MThd'
    0x00, 0x00, 0x00, 0x06, // Chunk length (6)
    0x00, 0x00,             // Format 0 (single track)
    0x00, 0x01,             // 1 Track
    (tpqn >> 8) & 0xff,     // TPQN High Byte
    tpqn & 0xff             // TPQN Low Byte
  ];
  
  // MTrk Track Chunk
  const trackHeaderBytes = [
    0x4d, 0x54, 0x72, 0x6b, // 'MTrk'
    (trackData.length >> 24) & 0xff, // Length 32-bit big-endian
    (trackData.length >> 16) & 0xff,
    (trackData.length >> 8) & 0xff,
    trackData.length & 0xff
  ];
  
  // Final assembly
  const totalLength = headerBytes.length + trackHeaderBytes.length + trackData.length;
  const midiFile = new Uint8Array(totalLength);
  
  midiFile.set(headerBytes, 0);
  midiFile.set(trackHeaderBytes, headerBytes.length);
  midiFile.set(trackData, headerBytes.length + trackHeaderBytes.length);
  
  return midiFile;
}
