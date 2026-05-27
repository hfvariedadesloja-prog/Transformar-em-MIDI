/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { TranscriptionSettings } from '../types';
import { Music, Sliders, Mic, Layers } from 'lucide-react';

interface Preset {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  settings: Partial<TranscriptionSettings>;
}

interface PresetLibraryProps {
  currentMode: string;
  onSelectPreset: (settings: Partial<TranscriptionSettings>) => void;
}

const PresetLibrary: React.FC<PresetLibraryProps> = ({ currentMode, onSelectPreset }) => {
  const presets: Preset[] = [
    {
      id: 'piano_classic',
      name: 'Piano Acústico',
      description: 'Ideal para solos de piano clássico ou teclado acústico em salas silenciosas.',
      icon: <Music className="w-5 h-5 text-blue-500" />,
      settings: {
        mode: 'polyphonic',
        noiseGate: 0.05,
        sensitivity: 0.14,
        minNoteDuration: 0.08,
        harmonicFilter: 0.45
      }
    },
    {
      id: 'synth_fast',
      name: 'Ritmo Rápido / Sintetizador',
      description: 'Garante respostas super-rápidas para notas curtas e ritmos acelerados.',
      icon: <Layers className="w-5 h-5 text-blue-500" />,
      settings: {
        mode: 'polyphonic',
        noiseGate: 0.04,
        sensitivity: 0.09,
        minNoteDuration: 0.04,
        harmonicFilter: 0.30
      }
    },
    {
      id: 'vocal_solo',
      name: 'Melodia / Solo (Monofônico)',
      description: 'Otimizado para canto, flauta, violino ou solos monofônicos. Ignora ruído de fundo.',
      icon: <Mic className="w-5 h-5 text-blue-500" />,
      settings: {
        mode: 'monophonic',
        noiseGate: 0.07,
        sensitivity: 0.15,
        minNoteDuration: 0.10,
        harmonicFilter: 0.00
      }
    },
    {
      id: 'vintage_rich',
      name: 'Harmônicos Ricos / Elétrico',
      description: 'Forte filtragem de oitavas e ressonâncias para pianos elétricos (Rhodes/Wurlitzer).',
      icon: <Sliders className="w-5 h-5 text-blue-500" />,
      settings: {
        mode: 'polyphonic',
        noiseGate: 0.08,
        sensitivity: 0.18,
        minNoteDuration: 0.14,
        harmonicFilter: 0.75
      }
    }
  ];

  return (
    <div className="flex flex-col w-full bg-[#0E131F] border border-slate-800 p-5 rounded-2xl shadow-xl">
      <h3 className="text-sm font-bold text-slate-200 mb-4 uppercase tracking-wider">Presets de Transcrição</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {presets.map((preset) => {
          const isActiveMode = preset.settings.mode === currentMode;
          
          return (
            <button
              key={preset.id}
              onClick={() => onSelectPreset(preset.settings)}
              className="flex items-start text-left p-4 rounded-xl border border-slate-800 bg-[#070A13] hover:bg-slate-900/40 hover:border-slate-700 transition cursor-pointer select-none group"
            >
              <div className="p-2.5 rounded-lg bg-[#0E131F] border border-slate-800 mr-3 group-hover:border-blue-500/30 transition-colors shrink-0">
                {preset.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 w-full">
                  <span className="text-sm font-bold text-slate-100 group-hover:text-blue-400 transition-colors leading-tight">
                    {preset.name}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 text-center uppercase tracking-normal shrink-0">
                    {preset.settings.mode === 'monophonic' ? 'Mono' : 'Poli'}
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                  {preset.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PresetLibrary;
