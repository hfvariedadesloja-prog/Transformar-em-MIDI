/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { MidiNoteEvent } from '../types';
import pSynth from '../lib/synth';
import { ZoomIn, ZoomOut, Focus, Disc } from 'lucide-react';

interface PianoRollProps {
  notes: MidiNoteEvent[];
  duration: number;
  currentTime: number;
  onSeek: (seconds: number) => void;
  bpm: number;
}

const PianoRoll: React.FC<PianoRollProps> = ({
  notes,
  duration,
  currentTime,
  onSeek,
  bpm
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Layout parameters with hooks for zooming
  const [zoomH, setZoomH] = useState<number>(80);  // Horizontal scale (pixels per second)
  const [zoomV, setZoomV] = useState<number>(14);  // Vertical scale (height of each note row in pixels)
  
  // Custom range alignment to focus on active octaves
  const [pitchRange, setPitchRange] = useState<{ min: number; max: number }>({ min: 36, max: 84 });

  // Update optimal pitch focus when notes change
  useEffect(() => {
    if (notes.length > 0) {
      let minActive = 108;
      let maxActive = 21;
      
      notes.forEach((note) => {
        if (note.pitch < minActive) minActive = note.pitch;
        if (note.pitch > maxActive) maxActive = note.pitch;
      });
      
      // Pad by 4 semitones on top and bottom for visual breathing room, inside MIDI bounds
      const minVal = Math.max(21, minActive - 4);
      const maxVal = Math.min(108, maxActive + 4);
      setPitchRange({ min: minVal, max: maxVal });
    } else {
      setPitchRange({ min: 36, max: 84 }); // Default fallback to middle registers
    }
  }, [notes]);

  // Center vertical scrolling on focus
  const focusOnNotes = () => {
    if (notes.length === 0 || !containerRef.current) return;
    
    // Find average active pitch
    let activeSum = 0;
    notes.forEach(n => activeSum += n.pitch);
    const avgPitch = activeSum / notes.length;
    
    const targetRow = 108 - avgPitch;
    const scrollY = targetRow * zoomV - containerRef.current.clientHeight / 2;
    containerRef.current.scrollTop = Math.max(0, scrollY);
  };

  useEffect(() => {
    // Scroll playhead into viewport if playing and moves past bounds
    if (containerRef.current && canvasRef.current) {
      const container = containerRef.current;
      const playheadX = currentTime * zoomH;
      const scrollMargin = 150;
      
      if (playheadX > container.scrollLeft + container.clientWidth - scrollMargin) {
        container.scrollLeft = playheadX - container.clientWidth + scrollMargin;
      } else if (playheadX < container.scrollLeft) {
        container.scrollLeft = Math.max(0, playheadX - scrollMargin);
      }
    }
  }, [currentTime, zoomH]);

  // Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rowCount = 108 - 21 + 1; // 88 note rows (row 0 is MIDI 108, row 87 is MIDI 21)
    const canvasWidth = Math.max(500, duration * zoomH + 80); // padding on right
    const canvasHeight = rowCount * zoomV;

    // Apply dimensions to high-DPI canvas
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    ctx.scale(dpr, dpr);

    // Clear background
    ctx.fillStyle = '#070A13'; // Sleek dark slate cavity
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Grid Helpers
    const isBlackPitch = (pitch: number) => {
      const r = pitch % 12;
      return r === 1 || r === 3 || r === 6 || r === 8 || r === 10;
    };

    // 1. Draw note row lanes
    for (let pitch = 21; pitch <= 108; pitch++) {
      const rowIdx = 108 - pitch;
      const topY = rowIdx * zoomV;
      
      // Lane backdrop
      if (isBlackPitch(pitch)) {
        ctx.fillStyle = '#0B0F19'; // Shaded lane for semi-tones
      } else {
        ctx.fillStyle = '#0E131F'; // Shaded lane for white keys
      }
      ctx.fillRect(0, topY, canvasWidth, zoomV);

      // Lane separator grid line
      ctx.strokeStyle = '#1e293b'; // slate-800 line
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, topY + zoomV);
      ctx.lineTo(canvasWidth, topY + zoomV);
      ctx.stroke();

      // Row indicator text on left side margins
      if (pitch % 12 === 0) {
        ctx.fillStyle = '#64748b'; // slate-500
        ctx.font = 'bold 8px monospace';
        const octave = Math.floor(pitch / 12) - 1;
        ctx.fillText(`C${octave}`, 6, topY + zoomV - 3);
      }
    }

    // 2. Draw vertical grid subdivisions (beat grids in tempo)
    const beatDuration = 60 / bpm;
    const totalBeats = Math.max(10, Math.ceil(duration / beatDuration));
    
    for (let i = 0; i <= totalBeats; i++) {
      const beatSec = i * beatDuration;
      const x = beatSec * zoomH;
      
      // Strong line for major beats, thin path for minor
      if (i % 4 === 0) {
        ctx.strokeStyle = '#334155'; // slate-700
        ctx.lineWidth = 1;
      } else {
        ctx.strokeStyle = '#1e293b'; // slate-800
        ctx.lineWidth = 0.5;
      }
      
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }

    // 3. Draw mapped note events
    notes.forEach((note) => {
      const rowIdx = 108 - note.pitch;
      const topY = rowIdx * zoomV;
      
      const xStart = note.startTime * zoomH;
      const xEnd = note.endTime * zoomH;
      const width = Math.max(3, xEnd - xStart);
      
      // Gradient or solid style reflecting selection play state and Hand Division (C4 / pitch 60 split)
      const isPlayActive = currentTime >= note.startTime && currentTime <= note.endTime;
      const isRightHand = note.pitch >= 60;
      
      if (isPlayActive) {
        if (isRightHand) {
          ctx.fillStyle = '#f59e0b'; // Glowing Amber (Active Right Hand)
          ctx.strokeStyle = '#fef08a';
        } else {
          ctx.fillStyle = '#06b6d4'; // Glowing Cyan (Active Left Hand)
          ctx.strokeStyle = '#22d3ee';
        }
      } else {
        if (isRightHand) {
          ctx.fillStyle = '#f97316'; // Warm Orange (Inactive Right Hand)
          ctx.strokeStyle = '#fdba74';
        } else {
          ctx.fillStyle = '#1d4ed8'; // Royal Blue (Inactive Left Hand)
          ctx.strokeStyle = '#3b82f6';
        }
      }
      
      ctx.lineWidth = 1.2;
      
      // Rounded note box drawing helper
      const r = Math.min(3, zoomV / 2 - 1);
      ctx.beginPath();
      ctx.roundRect(xStart + 1, topY + 1, width - 2, zoomV - 2, r);
      ctx.fill();
      ctx.stroke();

      // Draw subtle pitch/velocity text inside longer notes
      if (width > 42 && zoomV >= 12) {
        ctx.fillStyle = isPlayActive 
          ? (isRightHand ? '#78350f' : '#083344')
          : (isRightHand ? '#451a03' : '#1e3a8a');
        ctx.font = '8px monospace';
        const notesRef = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const label = `${notesRef[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}`;
        ctx.fillText(label, xStart + 5, topY + zoomV - 3);
      }
    });

    // 4. Draw timeline vertical playhead
    const playheadX = currentTime * zoomH;
    ctx.strokeStyle = '#ef4444'; // red-500
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, canvasHeight);
    ctx.stroke();

    // Triangle marker on playhead top
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(playheadX - 6, 0);
    ctx.lineTo(playheadX + 6, 0);
    ctx.lineTo(playheadX, 8);
    ctx.fill();

  }, [notes, duration, currentTime, zoomH, zoomV, bpm]);

  // Click seeking on canvas
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    // Seek calculations based on click position
    const targetSeconds = clickX / zoomH;
    onSeek(Math.min(duration, Math.max(0, targetSeconds)));

    // Interactive Piano Roll: trigger synth if they click directly on an active note block!
    const rowIdx = Math.floor(clickY / zoomV);
    const clickedPitch = 108 - rowIdx;
    const seekTime = clickX / zoomH;

    const hitNote = notes.find(n => n.pitch === clickedPitch && seekTime >= n.startTime && seekTime <= n.endTime);
    if (hitNote) {
      pSynth.playNote(hitNote.pitch, 'triangle', hitNote.velocity);
      setTimeout(() => pSynth.stopNote(hitNote.pitch), 250);
    }
  };

  return (
    <div className="flex flex-col w-full bg-[#0E131F] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative">
      {/* Visual Navigation controls bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between px-4 py-3 bg-[#070A13] border-b border-slate-800 gap-2">
        <div className="flex items-center space-x-3.5">
          <Disc className="w-5 h-5 text-blue-500 animate-spin" style={{ animationDuration: '6s' }} />
          <div>
            <h4 className="text-sm font-bold text-slate-200 tracking-wider">PIANO ROLL TRANSCRITO</h4>
            <p className="text-xs text-slate-400">Arraste a timeline ou clique nas notas para escutar</p>
          </div>
        </div>

        {/* Action Widgets */}
        <div className="flex items-center gap-3 self-start sm:self-auto select-none">
          <button
            onClick={focusOnNotes}
            disabled={notes.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-800 bg-[#0e131f] hover:bg-slate-800 hover:border-slate-700 text-slate-300 transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            title="Ajustar tela verticalmente nos registros das notas"
          >
            <Focus className="w-4 h-4 text-blue-500" />
            <span>Focar Notas</span>
          </button>

          <div className="h-5 w-[1px] bg-slate-850"></div>

          {/* Horizontal zoom controls */}
          <div className="flex items-center bg-slate-950 rounded-xl border border-slate-800 p-0.5">
            <button
              onClick={() => setZoomH(Math.max(30, zoomH - 12))}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-850 rounded transition cursor-pointer"
              title="Diminuir Zoom Horizontal"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-bold text-slate-500 px-1.5 select-none uppercase tracking-wider">H-Zoom</span>
            <button
              onClick={() => setZoomH(Math.min(220, zoomH + 12))}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-850 rounded transition cursor-pointer"
              title="Aumentar Zoom Horizontal"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Vertical zoom controls */}
          <div className="flex items-center bg-slate-950 rounded-xl border border-slate-800 p-0.5">
            <button
              onClick={() => setZoomV(Math.max(8, zoomV - 2))}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-850 rounded transition cursor-pointer"
              title="Diminuir Altura das Notas"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-bold text-slate-500 px-1.5 select-none uppercase tracking-wider">V-Zoom</span>
            <button
              onClick={() => setZoomV(Math.min(28, zoomV + 2))}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-850 rounded transition cursor-pointer"
              title="Aumentar Altura das Notas"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main scroller layout */}
      <div 
        ref={containerRef}
        className="w-full h-[320px] overflow-auto bg-[#070A13] scrollbar-thin scrollbar-thumb-slate-850 scrollbar-track-transparent custom-piano-roll-scroller"
        style={{ scrollBehavior: 'auto' }}
      >
        <div className="relative">
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="block cursor-crosshair"
          />
        </div>
      </div>

      {/* Stats bar indicator bottom */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-[#070A13] px-4 py-3 border-t border-slate-800 text-xs text-slate-400 gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span>Freq: {Math.round(1000 / (1024 / 44.1))} ms</span>
          <span className="text-slate-800">|</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_6px_#f59e0b]"></span>
            <span>Mão Direita (Treble, C4+):</span>
            <strong className="text-amber-400 font-bold">{notes.filter(n => n.pitch >= 60).length}</strong>
          </span>
          <span className="text-slate-800">|</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_6px_#3b82f6]"></span>
            <span>Mão Esquerda (Bass):</span>
            <strong className="text-blue-400 font-bold">{notes.filter(n => n.pitch < 60).length}</strong>
          </span>
        </div>
        <div>Total Filtrado: <span className="text-blue-400 font-bold">{notes.length}</span></div>
      </div>
    </div>
  );
};

export default PianoRoll;
