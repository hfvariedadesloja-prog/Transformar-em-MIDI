/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

interface AudioWaveformProps {
  audioBuffer: AudioBuffer | null;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  isMuted: boolean;
  onMuteToggle: () => void;
}

const AudioWaveform: React.FC<AudioWaveformProps> = ({
  audioBuffer,
  currentTime,
  duration,
  onSeek,
  isMuted,
  onMuteToggle
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Compute symmetric amplitude peaks on load
  useEffect(() => {
    if (!audioBuffer) {
      setPeaks([]);
      return;
    }

    const rawData = audioBuffer.getChannelData(0); // Use mono channel 0
    const samplePoints = 250;                     // resolution bars count
    const step = Math.floor(rawData.length / samplePoints);
    const calculatedPeaks: number[] = [];

    for (let i = 0; i < samplePoints; i++) {
      let maxAbsVal = 0;
      const start = i * step;
      const end = Math.min(start + step, rawData.length);

      for (let j = start; j < end; j++) {
        const val = Math.abs(rawData[j]);
        if (val > maxAbsVal) {
          maxAbsVal = val;
        }
      }
      // Add a tiny floor value so bars never disappear entirely
      calculatedPeaks.push(Math.max(0.04, maxAbsVal));
    }

    // Normalize peaks
    const maxVal = Math.max(...calculatedPeaks);
    if (maxVal > 0) {
      setPeaks(calculatedPeaks.map((p) => p / maxVal));
    } else {
      setPeaks(calculatedPeaks);
    }
  }, [audioBuffer]);

  // Draw Waveform Bars on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Apply high DPI adjustments
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.getBoundingClientRect().width * dpr;
    canvas.height = canvas.getBoundingClientRect().height * dpr;
    ctx.scale(dpr, dpr);

    const normalWidth = canvas.getBoundingClientRect().width;
    const normalHeight = canvas.getBoundingClientRect().height;

    ctx.clearRect(0, 0, normalWidth, normalHeight);

    const barWidth = normalWidth / peaks.length;
    const progressPercent = currentTime / (duration || 1);
    const activeThresholdIdx = Math.floor(peaks.length * progressPercent);

    // Draw each symmetrical vertical wave bar
    peaks.forEach((peak, i) => {
      const x = i * barWidth;
      const peakHeight = peak * (normalHeight * 0.75); // scale down to leave minor padding at vertical boundaries
      const yTop = (normalHeight - peakHeight) / 2;

      const isPassed = i <= activeThresholdIdx;

      // Color scheme transitions
      if (isPassed) {
        // Glowing Blue accent
        ctx.fillStyle = '#3b82f6'; // blue-500
      } else {
        ctx.fillStyle = '#334155'; // slate-700
      }

      // Draw rounded rectangle for gorgeous professional look
      const cornerRadius = 2.5;
      ctx.beginPath();
      ctx.roundRect(x + 1.2, yTop, barWidth - 2.4, peakHeight, cornerRadius);
      ctx.fill();
    });

    // Draw dynamic progress playhead needle
    const needleX = progressPercent * normalWidth;
    ctx.strokeStyle = '#3b82f6'; // blue-500
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(needleX, 0);
    ctx.lineTo(needleX, normalHeight);
    ctx.stroke();

  }, [peaks, currentTime, duration]);

  // Handle Seeks via Clicking / Dragging
  const handleSeekEvent = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || duration === 0) return;

    const rect = canvas.getBoundingClientRect();
    let clientX = 0;

    if ('touches' in e) {
      if (e.touches.length === 0) return;
      clientX = e.touches[0].clientX;
    } else {
      clientX = e.clientX;
    }

    const clickX = clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, clickX / rect.width));
    onSeek(ratio * duration);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    handleSeekEvent(e);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      handleSeekEvent(e);
    }
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  if (!audioBuffer) return null;

  return (
    <div className="flex flex-col w-full bg-[#0E131F] border border-slate-800 p-5 rounded-2xl shadow-xl transition-all">
      {/* Header controls metadata */}
      <div className="flex items-center justify-between mb-4 text-sm select-none">
        <div className="flex items-center space-x-2.5">
          <span className="text-slate-300 font-bold uppercase tracking-wider text-xs">Reprodução de Áudio</span>
          <span className="text-slate-700">|</span>
          <span className="text-blue-400 font-extrabold text-sm">{formatTime(currentTime)}</span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-400 text-sm">{formatTime(duration)}</span>
        </div>

        {/* Dynamic Mute control */}
        <button
          onClick={onMuteToggle}
          className="flex items-center space-x-2 text-slate-300 hover:text-white transition cursor-pointer px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold"
        >
          {isMuted ? (
            <>
              <VolumeX className="w-4 h-4 text-red-400" />
              <span>Mutado</span>
            </>
          ) : (
            <>
              <Volume2 className="w-4 h-4 text-blue-400 animate-pulse" />
              <span>Áudio Lógico</span>
            </>
          )}
        </button>
      </div>

      {/* Symmetrical wave timeline display */}
      <div className="relative w-full h-24 bg-[#070A13] rounded-2xl overflow-hidden border border-slate-800/60 shadow-inner">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          onTouchStart={handleSeekEvent}
          onTouchMove={handleSeekEvent}
          className="w-full h-full block cursor-ew-resize opacity-90 hover:opacity-100 transition-opacity"
        />
      </div>

      <div className="mt-3 text-xs text-slate-400 text-right select-none leading-relaxed">
        Mute o áudio original se quiser escutar apenas o sintetizador MIDI!
      </div>
    </div>
  );
};

export default AudioWaveform;
