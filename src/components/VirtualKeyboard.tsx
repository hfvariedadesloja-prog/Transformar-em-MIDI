/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import pSynth from '../lib/synth';

interface VirtualKeyboardProps {
  activeNotes: Set<number>;
  onKeyTrigger?: (pitch: number, active: boolean) => void;
}

const MIDI_MIN = 21;  // A0
const MIDI_MAX = 108; // C8

// Check if a MIDI pitch is a white key
function isWhiteKey(pitch: number): boolean {
  const r = pitch % 12;
  return r === 0 || r === 2 || r === 4 || r === 5 || r === 7 || r === 9 || r === 11;
}

// Get the letter format for keyboard notes
function getNoteName(pitch: number): string {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(pitch / 12) - 1;
  return `${notes[pitch % 12]}${octave}`;
}

const VirtualKeyboard: React.FC<VirtualKeyboardProps> = ({ activeNotes, onKeyTrigger }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to center (around C4/C5, MIDI 60) on creation
  useEffect(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      // Scroll to approx center white keys
      const middleKeyElement = container.querySelector('[id*="key-60"]');
      if (middleKeyElement) {
        const offsetLeft = (middleKeyElement as HTMLElement).offsetLeft;
        container.scrollLeft = offsetLeft - container.clientWidth / 2 + 30;
      }
    }
  }, []);

  const handleKeyPress = (pitch: number) => {
    pSynth.playNote(pitch, 'triangle', 90);
    if (onKeyTrigger) onKeyTrigger(pitch, true);
  };

  const handleKeyRelease = (pitch: number) => {
    pSynth.stopNote(pitch);
    if (onKeyTrigger) onKeyTrigger(pitch, false);
  };

  // Build the list of keys to display
  const keys: React.ReactNode[] = [];

  for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
    if (isWhiteKey(pitch)) {
      const isActive = activeNotes.has(pitch);
      
      // Determine if a black key overlaps to its right
      const nextPitch = pitch + 1;
      const hasBlackSibling = nextPitch <= MIDI_MAX && !isWhiteKey(nextPitch);
      const isBlackActive = activeNotes.has(nextPitch);
      
      const showLabel = pitch % 12 === 0; // Show label mainly on C notes to avoid clutter

      keys.push(
        <div 
          key={`white-container-${pitch}`}
          id={`key-${pitch}`}
          className="relative select-none flex-shrink-0"
          style={{ width: '42px', height: '170px' }}
        >
          {/* White Key */}
          <button
            onMouseDown={() => handleKeyPress(pitch)}
            onMouseUp={() => handleKeyRelease(pitch)}
            onMouseLeave={() => handleKeyRelease(pitch)}
            onTouchStart={(e) => {
              e.preventDefault();
              handleKeyPress(pitch);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleKeyRelease(pitch);
            }}
            id={`btn-white-${pitch}`}
            className={`w-full h-full border-r border-b border-l border-slate-300 rounded-b transition-all duration-100 flex flex-col justify-end pb-3 items-center text-xs font-bold select-none cursor-pointer ${
              isActive 
                ? (pitch >= 60 ? 'bg-amber-500 text-white border-amber-600 shadow-inner translate-y-[1px]' : 'bg-sky-500 text-white border-sky-600 shadow-inner translate-y-[1px]')
                : 'bg-white hover:bg-slate-100 text-slate-450 border-slate-250'
            }`}
          >
            {showLabel && <span className="pointer-events-none select-none font-extrabold text-[#0E131F]">{getNoteName(pitch)}</span>}
          </button>

          {/* Overlapping Black Key on the right half */}
          {hasBlackSibling && (
            <button
              onMouseDown={(e) => {
                e.stopPropagation();
                handleKeyPress(nextPitch);
              }}
              onMouseUp={(e) => {
                e.stopPropagation();
                handleKeyRelease(nextPitch);
              }}
              onMouseLeave={(e) => {
                e.stopPropagation();
                handleKeyRelease(nextPitch);
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleKeyPress(nextPitch);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleKeyRelease(nextPitch);
              }}
              id={`btn-black-${nextPitch}`}
              className={`absolute top-0 right-[-14px] w-[26px] h-[105px] rounded-b border transition-all duration-100 flex flex-col justify-end pb-2 items-center text-[9px] select-none cursor-pointer z-20 shadow-md ${
                isBlackActive
                  ? (nextPitch >= 60 ? 'bg-amber-600 text-white border-amber-700 shadow-inner' : 'bg-sky-600 text-white border-sky-700 shadow-inner')
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-500 border-slate-950'
              }`}
            >
              {nextPitch % 12 === 1 && (
                <span className="pointer-events-none select-none text-[9px] font-bold text-slate-300">
                  {getNoteName(nextPitch)}
                </span>
              )}
            </button>
          )}
        </div>
      );
    }
  }

  return (
    <div className="flex flex-col w-full bg-[#0E131F] border border-slate-800 p-5 rounded-2xl shadow-xl relative overflow-hidden">
      {/* Top control guide bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-2 pb-2.5 border-b border-slate-800 mb-3 gap-2">
        <div className="flex items-center space-x-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></div>
          <span className="text-sm font-bold text-slate-200">Teclado Virtual (88 Teclas)</span>
          <span className="text-slate-800 text-xs hidden sm:inline">|</span>
          <div className="hidden sm:flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded bg-amber-500"></span>
              Mão Direita (Melodia, C4+)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded bg-sky-500"></span>
              Mão Esquerda (Baixos)
            </span>
          </div>
        </div>
        <div className="text-xs text-slate-400">
          Clique nas teclas para auditar
        </div>
      </div>

      {/* Piano Keys Horizontal scroller */}
      <div 
        ref={scrollContainerRef}
        className="flex w-full overflow-x-auto pb-4 pt-1 px-1 bg-[#070A13] rounded-xl scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent select-none"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="flex select-none relative pr-4">
          {keys}
        </div>
      </div>
    </div>
  );
};

export default VirtualKeyboard;
