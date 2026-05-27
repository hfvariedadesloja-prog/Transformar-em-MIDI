/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  FileAudio, Upload, Play, Pause, RotateCcw, Download, 
  Settings, Music2, Cpu, Sparkles, HelpCircle, CheckCircle2, 
  AlertCircle, ChevronRight, SlidersHorizontal, Keyboard
} from 'lucide-react';
import { MidiNoteEvent, TranscriptionSettings, AudioFileData } from '../types';
import { transcribeAudio } from '../lib/audioAnalyzer';
import { encodeMIDI } from '../lib/midiEncoder';
import pSynth from '../lib/synth';

// Subcomponents
import AudioWaveform from './AudioWaveform';
import PianoRoll from './PianoRoll';
import VirtualKeyboard from './VirtualKeyboard';
import PresetLibrary from './PresetLibrary';

export default function Dashboard() {
  // Original audio variables
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  
  // Playback control state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Transcription state engine
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState<number>(0);
  const [transcriptionStatus, setTranscriptionStatus] = useState<string>('');
  const [notes, setNotes] = useState<MidiNoteEvent[]>([]);
  const [activeSynthNotes, setActiveSynthNotes] = useState<Set<number>>(new Set());

  // Default parameters
  const [settings, setSettings] = useState<TranscriptionSettings>({
    mode: 'polyphonic',
    noiseGate: 0.05,
    sensitivity: 0.14,
    minNoteDuration: 0.08,
    harmonicFilter: 0.45,
    bpm: 120,
    quantize: 'none',
  });

  // Auto-apply transcription when parameters change
  const [autoApply, setAutoApply] = useState<boolean>(false);
  const [hasPendingChanges, setHasPendingChanges] = useState<boolean>(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Keyboard training simulation settings
  const [trainingHand, setTrainingHand] = useState<'both' | 'right' | 'left'>('both');
  const [practiceDifficulty, setPracticeDifficulty] = useState<'normal' | 'simplified'>('normal');
  const [snapSuccessMessage, setSnapSuccessMessage] = useState<string | null>(null);

  // Memoized filtered and simplified notes for simulated practice
  const processedNotes = React.useMemo(() => {
    if (notes.length === 0) return [];
    
    let filtered = [...notes];
    
    // 1. Apply simplification algorithm of notes (Dificuldade Facilitada)
    if (practiceDifficulty === 'simplified') {
      const simplified: MidiNoteEvent[] = [];
      const leftNotes = filtered.filter(n => n.pitch < 60);
      const rightNotes = filtered.filter(n => n.pitch >= 60);
      
      // Simplify Left Hand: Keep only the lowest pitch (bass root) in each 150ms window
      // avoiding confusing clusters for beginners
      const leftByWindow: { [key: string]: MidiNoteEvent } = {};
      leftNotes.forEach(note => {
        const win = Math.round(note.startTime * 6); // ~160ms time window
        const key = `${win}`;
        if (!leftByWindow[key] || note.pitch < leftByWindow[key].pitch) {
          leftByWindow[key] = note;
        }
      });
      simplified.push(...Object.values(leftByWindow));
      
      // Simplify Right Hand: Keep only the highest pitch (melody line) in each 150ms window
      const rightByWindow: { [key: string]: MidiNoteEvent } = {};
      rightNotes.forEach(note => {
        const win = Math.round(note.startTime * 6);
        const key = `${win}`;
        if (!rightByWindow[key] || note.pitch > rightByWindow[key].pitch) {
          rightByWindow[key] = note;
        }
      });
      simplified.push(...Object.values(rightByWindow));
      
      filtered = simplified;
    }
    
    // 2. Filter by hand selection (Mão Direita / Esquerda / Ambas)
    if (trainingHand === 'right') {
      filtered = filtered.filter(n => n.pitch >= 60);
    } else if (trainingHand === 'left') {
      filtered = filtered.filter(n => n.pitch < 60);
    }
    
    // Sort chronologically for safety
    return filtered.sort((a, b) => a.startTime - b.startTime);
  }, [notes, trainingHand, practiceDifficulty]);

  // AI Assistant Analysis
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [aiReport, setAiReport] = useState<any | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Refs for tracking node elements
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const currentlyPlayingNotesRef = useRef<Set<number>>(new Set());

  // Clean play state on unload
  useEffect(() => {
    return () => {
      pSynth.stopAll();
    };
  }, []);

  // Sync original audio with synthesizers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let animFrame: number;

    const updatePlayhead = () => {
      const time = audio.currentTime;
      setCurrentTime(time);

      // Realtime Audio-to-Synth note scheduler
      if (processedNotes.length > 0) {
        const activeNotes = new Set<number>();
        processedNotes.forEach((note) => {
          if (time >= note.startTime && time <= note.endTime) {
            activeNotes.add(note.pitch);
          }
        });

        // Trigger notes on visual keyboard
        activeNotes.forEach((pitch) => {
          if (!currentlyPlayingNotesRef.current.has(pitch)) {
            currentlyPlayingNotesRef.current.add(pitch);
            pSynth.playNote(pitch, 'triangle', 80);
          }
        });

        // Release notes past trigger margins
        currentlyPlayingNotesRef.current.forEach((pitch) => {
          if (!activeNotes.has(pitch)) {
            currentlyPlayingNotesRef.current.delete(pitch);
            pSynth.stopNote(pitch);
          }
        });

        setActiveSynthNotes(new Set(activeNotes));
      }

      if (isPlaying) {
        animFrame = requestAnimationFrame(updatePlayhead);
      }
    };

    if (isPlaying) {
      animFrame = requestAnimationFrame(updatePlayhead);
    } else {
      // Release synthesizers when pausing original audio
      pSynth.stopAll();
      currentlyPlayingNotesRef.current.clear();
      setActiveSynthNotes(new Set());
    }

    return () => {
      cancelAnimationFrame(animFrame);
    };
  }, [isPlaying, processedNotes]);

  // Handle Drag & Drop of audio files
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processSelectedFile(e.target.files[0]);
    }
  };

  // Process and decode raw audio upload
  const processSelectedFile = async (file: File) => {
    if (!file.type.startsWith('audio/') && !file.name.endsWith('.mp3') && !file.name.endsWith('.wav')) {
      alert('Por favor, envie um arquivo de áudio válido (.mp3, .wav, etc).');
      return;
    }

    // Reset old stats and pause native player
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
    pSynth.stopAll();
    setNotes([]);
    setAiReport(null);
    setAiError(null);
    
    setAudioFile(file);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);

    // Dynamic Decode audio
    setIsTranscribing(true);
    setTranscriptionProgress(2);
    setTranscriptionStatus('Identificando sinal e decodificando áudio...');

    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const arrayBuffer = await file.arrayBuffer();
      const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      setAudioBuffer(decodedBuffer);
      setDuration(decodedBuffer.duration);
      setCurrentTime(0);

      // Trigger automatic initial transcription on load
      const initialNotes = await transcribeAudio(
        decodedBuffer,
        settings,
        (percent, status) => {
          setTranscriptionProgress(percent);
          setTranscriptionStatus(status);
        }
      );

      setNotes(initialNotes);
    } catch (e: any) {
      console.error('Falha de decodificação:', e);
      alert('Não foi possível ler este arquivo de áudio. Tente usar outro formato.');
    } finally {
      setIsTranscribing(false);
    }
  };

  // Re-transcribe when parameters update manually
  const triggerTranscription = async (customSettings?: any) => {
    if (!audioBuffer) return;

    if (audioRef.current) {
      audioRef.current.pause();
    }
    
    // Determine the parameters to use
    const activeSettings = (customSettings && typeof customSettings === 'object' && 'mode' in customSettings) 
      ? customSettings 
      : settings;

    setIsTranscribing(true);
    setAiReport(null);
    setAiError(null);
    setIsPlaying(false);
    
    // Release synthesizers when starting re-analysis
    pSynth.stopAll();
    currentlyPlayingNotesRef.current.clear();
    setActiveSynthNotes(new Set());
    
    try {
      const processedNotes = await transcribeAudio(
        audioBuffer,
        activeSettings,
        (percent, status) => {
          setTranscriptionProgress(percent);
          setTranscriptionStatus(status);
        }
      );
      setNotes(processedNotes);
    } catch (e) {
      console.error('Falha na re-transcrição de áudio:', e);
    } finally {
      setIsTranscribing(false);
      setHasPendingChanges(false);
    }
  };

  // Seek time handler with synthesizer cleanup
  const handleSeek = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = seconds;
      setCurrentTime(seconds);
      
      // Clear hanging synthesizers on seek jump
      pSynth.stopAll();
      currentlyPlayingNotesRef.current.clear();
      setActiveSynthNotes(new Set());
    }
  };

  // Toggle audio play/pause manually with browser-safe gesture trigger
  const togglePlay = () => {
    if (isTranscribing) return;
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch((err) => {
        console.error('Falha de reprodução de áudio:', err);
      });
    }
  };

  // Quantization preset triggers
  const handleSelectPreset = async (presetSettings: Partial<TranscriptionSettings>) => {
    const updated = { ...settings, ...presetSettings };
    setSettings(updated);
    if (audioBuffer) {
      await triggerTranscription(updated);
    }
  };

  // Download export helper
  const handleDownloadMidi = () => {
    if (processedNotes.length === 0) return;
    
    try {
      const midiBytes = encodeMIDI(processedNotes, settings.bpm);
      const blob = new Blob([midiBytes], { type: 'audio/midi' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      // Strip extension
      const baseName = (audioFile?.name || 'transcricao_aula')
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9_\-]/g, '_');
      
      // Dynamic suffix based on current configuration
      let suffix = '';
      if (trainingHand === 'right') suffix = '_mao_direita';
      else if (trainingHand === 'left') suffix = '_mao_esquerda';
      else suffix = '_ambas_maos';
      
      if (practiceDifficulty === 'simplified') {
        suffix += '_facilitado';
      }
      
      a.download = `${baseName}${suffix}.mid`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Falha ao exportar arquivo midi:', e);
    }
  };
 
  // Forced global snap-to-grid algorithm for slightly off notes
  const handleForcedGlobalSnap = () => {
    if (notes.length === 0) return;
    
    // 1. Determine tempo and quantization step support
    const bpm = settings.bpm;
    const beatDuration = 60 / bpm;
    
    // Default to 1/16 if quantization is none, otherwise use selected quantization
    const quantType = settings.quantize === 'none' ? '1/16' : settings.quantize;
    let division = 0.25; // 1/16th note
    switch (quantType) {
      case '1/4': division = 1; break;
      case '1/8': division = 0.5; break;
      case '1/16': division = 0.25; break;
      case '1/32': division = 0.125; break;
    }
    
    const stepDuration = beatDuration * division;
    
    // 2. Perform global timing snap and pitch tuning adjustments
    const snappedNotes: MidiNoteEvent[] = notes.map((note) => {
      // Snap start and end times to the nearest grid step
      const qStart = Math.round(note.startTime / stepDuration) * stepDuration;
      let qEnd = Math.round(note.endTime / stepDuration) * stepDuration;
      
      // Ensure notes maintain minimum playable duration of at least 1 grid step
      if (qEnd <= qStart) {
        qEnd = qStart + stepDuration;
      }
      
      // Pitch "tuning" correction: Ensure pitch is integer and within valid piano keys limits (21 to 108)
      const tunedPitch = Math.max(21, Math.min(108, Math.round(note.pitch)));
      
      return {
        ...note,
        startTime: qStart,
        endTime: qEnd,
        pitch: tunedPitch
      };
    });

    // 3. Remove duplicate overlapping notes of identical pitches and very short artifacts
    // Sort chronologically
    snappedNotes.sort((a, b) => a.startTime - b.startTime);
    
    const cleanedNotes: MidiNoteEvent[] = [];
    const recentNotesMap = new Map<number, { endTime: number; id: string }>();
    
    snappedNotes.forEach((note) => {
      const duration = note.endTime - note.startTime;
      // Skip extreme micro-notes/glitch artifacts smaller than half of the step duration
      if (duration < stepDuration * 0.4) return;
      
      const lastNote = recentNotesMap.get(note.pitch);
      
      if (lastNote) {
        // If there's high overlap, merge or skip the duplicate to keep transcription clean
        if (note.startTime < lastNote.endTime) {
          // Adjust previous note's end time to prevent overlaps
          const lastIdx = cleanedNotes.findIndex(n => n.id === lastNote.id);
          if (lastIdx !== -1) {
            cleanedNotes[lastIdx].endTime = note.startTime;
          }
        }
      }
      
      cleanedNotes.push(note);
      recentNotesMap.set(note.pitch, { endTime: note.endTime, id: note.id });
    });
    
    // 4. Update state with snapped/tuned notes
    setNotes(cleanedNotes);
    
    // 5. Trigger synthetic light double chime
    try {
      pSynth.playNote(72, 'sine', 50); // C5
      setTimeout(() => { pSynth.stopNote(72); }, 150);
      setTimeout(() => {
        pSynth.playNote(76, 'sine', 55); // E5
        setTimeout(() => { pSynth.stopNote(76); }, 150);
      }, 80);
    } catch (e) {
      console.warn('Audio feedback failed:', e);
    }

    // 6. Trigger a visual success message
    setSnapSuccessMessage(`Snap global forçado aplicado! ${cleanedNotes.length} notas alinhadas perfeitamente ao grid (${quantType}, BPM: ${bpm}).`);
    
    // Auto-clear notification after 4.5s
    setTimeout(() => {
      setSnapSuccessMessage(null);
    }, 4500);
  };

  // Estimate song BPM from transcribed note intervals (IOIs)
  const handleAutoDetectBPM = () => {
    if (notes.length < 5) {
      setSnapSuccessMessage("Notas insuficientes para autodetectar o andamento. É preciso no mínimo 5 notas.");
      setTimeout(() => setSnapSuccessMessage(null), 3000);
      return;
    }

    // Capture unique onsets to filter dense chords
    const times: number[] = notes.map((n): number => Math.round(n.startTime * 1000) / 1000);
    const uniqueTimes: number[] = Array.from(new Set<number>(times));
    const onsets: number[] = uniqueTimes.sort((a, b) => a - b);
    
    // Calculate difference intervals
    const iois: number[] = [];
    for (let i = 1; i < onsets.length; i++) {
      const diff: number = onsets[i] - onsets[i - 1];
      if (diff > 0.09 && diff < 2.0) {
        iois.push(diff);
      }
    }

    if (iois.length < 3) {
      setSnapSuccessMessage("Padrão rítmico insuficiente para calcular. Ajuste o metrônomo manualmente.");
      setTimeout(() => setSnapSuccessMessage(null), 3500);
      return;
    }

    // Take the median interval
    const sortedIois = [...iois].sort((a, b) => a - b);
    const medianIoi = sortedIois[Math.floor(sortedIois.length / 2)];

    let estimatedBpm = 60 / medianIoi;

    // Squeeze estimate within the natural keyboard learning tempo bucket (70 - 160 BPM)
    while (estimatedBpm < 70) {
      estimatedBpm *= 2;
    }
    while (estimatedBpm > 160) {
      estimatedBpm /= 2;
    }

    const finalBpm = Math.round(estimatedBpm);
    
    setSettings(prev => ({ ...prev, bpm: finalBpm }));
    setHasPendingChanges(true); // Highlights the transcription trigger button to let user re-process

    try {
      pSynth.playNote(76, 'sine', 60); // Clean audit beep
      setTimeout(() => pSynth.stopNote(76), 150);
    } catch(e){}

    setSnapSuccessMessage(`Andamento calculado do áudio! Ajustado para ${finalBpm} BPM. Clique em "Aplicar Novos Parâmetros" para recalcular o tempo da gravação.`);
    setTimeout(() => setSnapSuccessMessage(null), 7000);
  };

  // Request AI Scale and Chords breakdown via server-side Gemini
  const handleAnalyzeWithAI = async () => {
    if (notes.length === 0) return;

    setIsAiLoading(true);
    setAiError(null);
    setAiReport(null);

    try {
      const response = await fetch('/api/analyze-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: notes,
          bpm: settings.bpm,
          filename: audioFile?.name || 'Áudio Sem Título'
        })
      });

      const data = await response.json();
      if (response.ok) {
        setAiReport(data);
      } else {
        setAiError(data.error || 'Não foi possível analisar as notas com IA neste momento.');
      }
    } catch (err: any) {
      console.error('Erro na chamada da API:', err);
      setAiError('Falha ao estabelecer conexão com o servidor de inteligência artificial.');
    } finally {
      setIsAiLoading(false);
    }
  };

  // Utility to handle form sliders
  const handleSliderChange = (key: keyof TranscriptionSettings, val: any) => {
    const updated = { ...settings, [key]: val };
    setSettings(updated);
    
    if (autoApply && audioBuffer) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        triggerTranscription(updated);
      }, 550);
    } else {
      setHasPendingChanges(true);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F19] text-slate-100 flex flex-col antialiased">
      {/* Invisible HTML5 Audio play node */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            pSynth.stopAll();
          }}
          muted={isMuted}
          className="hidden"
        />
      )}

      {/* Modern Workspace Header */}
      <header className="border-b border-slate-800 bg-[#0E131F]/90 backdrop-blur sticky top-0 z-40 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5 select-none">
            <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
              <Keyboard className="w-6 h-6 stroke-[2.2]" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Audio para MIDI Studio <span className="text-[11px] px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase font-semibold">Free & Pro v1.2</span>
              </h1>
              <p className="text-sm text-slate-300 mt-1">Transforme MP3 e WAV em arquivos MIDI limpos para aplicativos de aulas de teclado</p>
            </div>
          </div>
          <div className="text-right hidden md:block">
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">WORKSPACE ESTÁVEL</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT SIDEBAR: Controls and Presets */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            
            {/* File upload zone */}
            <div 
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center text-center transition-all min-h-[180px] cursor-pointer ${
                audioFile 
                  ? 'border-blue-500/40 bg-blue-500/[0.02] hover:border-blue-500/60' 
                  : 'border-slate-800 bg-[#0E131F]/40 hover:border-slate-700 hover:bg-[#0E131F]/70'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileSelect}
                className="hidden"
              />
              
              {!audioFile ? (
                <>
                  <div className="p-4 rounded-full bg-[#070A13] border border-slate-800 text-blue-500 mb-3.5 shadow-md">
                    <Upload className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-200">Importar seu áudio (MP3 ou WAV)</h3>
                  <p className="text-xs text-slate-400 mt-2 px-4 leading-relaxed">
                    Arraste o arquivo aqui ou clique para navegar localmente
                  </p>
                </>
              ) : (
                <>
                  <div className="p-4 rounded-full bg-blue-600 text-white mb-3 shadow-md animate-pulse">
                    <FileAudio className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-100 max-w-xs break-all truncate">
                    {audioFile.name}
                  </h3>
                  <p className="text-xs text-blue-400 font-medium mt-1.5">
                    Decodificado: {Math.round(duration)}s | {(audioFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <span className="text-xs text-slate-300 bg-slate-900 border border-slate-800 rounded px-3 py-1 mt-3 select-none hover:bg-slate-800">
                    Clique para trocar de arquivo
                  </span>
                </>
              )}
            </div>

            {/* Presets library rendering */}
            <PresetLibrary 
              currentMode={settings.mode} 
              onSelectPreset={handleSelectPreset} 
            />

            {/* Advanced Algorithm Parameters Card */}
            <div className="bg-[#0E131F] border border-slate-800 rounded-2xl p-5 shadow-xl select-none">
              <div className="flex items-center justify-between pb-3.5 border-b border-slate-800 mb-4">
                <div className="flex items-center space-x-2.5">
                  <SlidersHorizontal className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-bold text-slate-200 uppercase tracking-wider">Parâmetros Finos</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold text-slate-400 hover:text-blue-400 transition-colors select-none">
                    <input 
                      type="checkbox" 
                      checked={autoApply} 
                      onChange={(e) => setAutoApply(e.target.checked)}
                      className="rounded border-slate-800 bg-[#070A13] text-blue-500 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer accent-blue-500"
                    />
                    <span>Auto-Atualizar</span>
                  </label>
                  <span className="text-slate-800 text-xs">|</span>
                  <HelpCircle className="w-4 h-4 text-slate-500 cursor-help" title="Configurações avançadas do transcritor de frequências harmônicas. Com o Auto-Atualizar ativado, as alterações nos controles são aplicadas de forma instantânea e em tempo real!" />
                </div>
              </div>

              <div className="flex flex-col gap-4">
                
                {/* Mode Selector */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Modo de Análise</label>
                    <div className="relative group/tooltip">
                      <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-blue-400 transition-colors cursor-help" />
                      <div className="absolute bottom-full left-1/4 -translate-x-1/2 mb-2 w-72 p-3 bg-slate-950/95 border border-slate-800 rounded-xl text-slate-300 font-normal normal-case text-[11px] leading-relaxed shadow-2xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-200 z-50 pointer-events-none">
                        <span className="font-bold text-blue-400 block mb-1">Como escolher o modo de áudio:</span>
                        • <strong className="text-white">Teclado / Acordes:</strong> Modo polifônico. Excelente para piano com duas mãos tocando acordes simultâneos.<br/>
                        • <strong className="text-white">Solo / Melodia:</strong> Modo monofônico. Perfeito para registrar uma única linha melódica pura, como voz ou flauta, filtrando outras cordas de fundo.
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 bg-[#070A13] p-1 rounded-lg border border-slate-800">
                    <button
                      onClick={() => handleSliderChange('mode', 'polyphonic')}
                      className={`py-1.5 text-xs font-bold rounded transition cursor-pointer select-none ${
                        settings.mode === 'polyphonic'
                          ? 'bg-blue-600 text-white shadow shadow-blue-600/20'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Teclado / Acordes
                    </button>
                    <button
                      onClick={() => handleSliderChange('mode', 'monophonic')}
                      className={`py-1.5 text-xs font-bold rounded transition cursor-pointer select-none ${
                        settings.mode === 'monophonic'
                          ? 'bg-blue-600 text-white shadow shadow-blue-600/20'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Solo / Melodia
                    </button>
                  </div>
                </div>

                {/* Noise Gate */}
                <div>
                  <div className="flex justify-between items-center text-xs font-semibold text-slate-300 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span>Limiar de Ruído (Gate)</span>
                      <div className="relative group/tooltip">
                        <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-blue-400 transition-colors cursor-help" />
                        <div className="absolute bottom-full left-1/4 -translate-x-1/2 mb-2 w-72 p-3 bg-slate-950/95 border border-slate-800 rounded-xl text-slate-300 font-normal normal-case text-[11px] leading-relaxed shadow-2xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-200 z-50 pointer-events-none">
                          <span className="font-bold text-blue-400 block mb-1">Corta ruídos e chiados:</span>
                          Define o limiar mínimo de onda eletrônica de áudio.<br/>
                          • <strong className="text-white">Valores altos (0.12 - 0.25):</strong> Limpam sussurros residuais, pedais persistentes e barulho de ventoinha ou sala.<br/>
                          • <strong className="text-white">Valores baixos (0.01 - 0.05):</strong> Mantêm os toques mais leves no piano quando a sala de gravação é totalmente silenciosa.
                        </div>
                      </div>
                    </div>
                    <span className="text-blue-400 font-bold text-sm bg-blue-500/10 px-2 py-0.5 rounded">{settings.noiseGate.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.01"
                    max="0.25"
                    step="0.01"
                    value={settings.noiseGate}
                    onChange={(e) => handleSliderChange('noiseGate', parseFloat(e.target.value))}
                    className="w-full h-1 bg-[#070A13] rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block leading-relaxed">Silencia sussurros, pedais ou resíduos gravados.</span>
                </div>

                {/* Trig Sensitivity */}
                <div>
                  <div className="flex justify-between items-center text-xs font-semibold text-slate-300 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span>Sensibilidade de Nota</span>
                      <div className="relative group/tooltip">
                        <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-blue-400 transition-colors cursor-help" />
                        <div className="absolute bottom-full left-1/4 -translate-x-1/2 mb-2 w-72 p-3 bg-slate-950/95 border border-slate-800 rounded-xl text-slate-300 font-normal normal-case text-[11px] leading-relaxed shadow-2xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-200 z-50 pointer-events-none">
                          <span className="font-bold text-blue-400 block mb-1">Precisão do gatilho:</span>
                          Ajuda a decidir quando um pico acústico vira nota no piano roll.<br/>
                          • <strong className="text-white">Mais sensível (baixo, 0.05 - 0.12):</strong> Registra dedilhados leves, mas pode capturar ecos e notas fantasma.<br/>
                          • <strong className="text-white">Menos sensível (alto, 0.15 - 0.35):</strong> Ideal para piano tocado de forma firme, tocando apenas notas óbvias.
                        </div>
                      </div>
                    </div>
                    <span className="text-blue-400 font-bold text-sm bg-blue-500/10 px-2 py-0.5 rounded">{settings.sensitivity.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.01"
                    max="0.45"
                    step="0.01"
                    value={settings.sensitivity}
                    onChange={(e) => handleSliderChange('sensitivity', parseFloat(e.target.value))}
                    className="w-full h-1 bg-[#070A13] rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block leading-relaxed">Configura a força que inicia o registro de teclas.</span>
                </div>

                {/* Minimum Duration */}
                <div>
                  <div className="flex justify-between items-center text-xs font-semibold text-slate-300 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span>Duração Mínima da Nota</span>
                      <div className="relative group/tooltip">
                        <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-blue-400 transition-colors cursor-help" />
                        <div className="absolute bottom-full left-1/4 -translate-x-1/2 mb-2 w-72 p-3 bg-slate-950/95 border border-slate-800 rounded-xl text-slate-300 font-normal normal-case text-[11px] leading-relaxed shadow-2xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-200 z-50 pointer-events-none">
                          <span className="font-bold text-blue-400 block mb-1">Filtro de toques rápidos:</span>
                          Determina o menor tempo que uma tecla precisa estar pressionada.<br/>
                          • <strong className="text-white">Curto (50ms - 80ms):</strong> Ideal para ritmos rápidos e staccatos arpejados.<br/>
                          • <strong className="text-white">Longo (120ms+):</strong> Excelente para baladas lentas de piano que evitam estalos rápidos que possam vazar no microfone.
                        </div>
                      </div>
                    </div>
                    <span className="text-blue-400 font-bold text-sm bg-blue-500/10 px-2 py-0.5 rounded">{Math.round(settings.minNoteDuration * 1000)}ms</span>
                  </div>
                  <input
                    type="range"
                    min="0.03"
                    max="0.50"
                    step="0.01"
                    value={settings.minNoteDuration}
                    onChange={(e) => handleSliderChange('minNoteDuration', parseFloat(e.target.value))}
                    className="w-full h-1 bg-[#070A13] rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block leading-relaxed">Evita notas estaladas acidentais.</span>
                </div>

                {/* Harmonic Suppression */}
                {settings.mode === 'polyphonic' && (
                  <div>
                    <div className="flex justify-between items-center text-xs font-semibold text-slate-300 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span>Supressão de Harmônicos</span>
                        <div className="relative group/tooltip">
                          <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-blue-400 transition-colors cursor-help" />
                          <div className="absolute bottom-full left-1/4 -translate-x-1/2 mb-2 w-72 p-3 bg-slate-950/95 border border-slate-800 rounded-xl text-slate-300 font-normal normal-case text-[11px] leading-relaxed shadow-2xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-200 z-50 pointer-events-none">
                            <span className="font-bold text-blue-400 block mb-1">Remove oitavas duplicadas:</span>
                            A física de uma corda de piano gera ressonâncias simpáticas (oitavas de apoio mais agudas). O algoritmo de supressão de harmônicos identifica e limpa essas notas "fantasmas", gerando um MIDI limpo.<br/>
                            • <strong className="text-white">Configuração recomendada:</strong> Deixar entre 40% a 60% para pianos acústicos tradicionais.
                          </div>
                        </div>
                      </div>
                      <span className="text-blue-400 font-bold text-sm bg-blue-500/10 px-2 py-0.5 rounded">{Math.round(settings.harmonicFilter * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.00"
                      max="1.00"
                      step="0.05"
                      value={settings.harmonicFilter}
                      onChange={(e) => handleSliderChange('harmonicFilter', parseFloat(e.target.value))}
                      className="w-full h-1 bg-[#070A13] rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <span className="text-[11px] text-slate-400 mt-1 block leading-relaxed">Silencia oitavas falsas que vazam sobre os tons reais.</span>
                  </div>
                )}

                <div className="h-[1px] bg-slate-800 my-1"></div>

                {/* Quantization presets and BPM */}
                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <label className="text-xs font-semibold text-slate-300 uppercase">Quantização</label>
                      <div className="relative group/tooltip">
                        <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-blue-400 transition-colors cursor-help" />
                        <div className="absolute bottom-full left-0 mb-2 w-72 p-3 bg-slate-950/95 border border-slate-800 rounded-xl text-slate-300 font-normal normal-case text-[11px] leading-relaxed shadow-2xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-200 z-50 pointer-events-none">
                          <span className="font-bold text-blue-400 block mb-1">Alinhamento temporal métrico:</span>
                          Arrasta os toques levemente fora do compasso para que fiquem 100% encaixados no ritmo absoluto de estúdio. Ideal para gerar arquivos de partitura perfeitamente limpos.<br/>
                          • <strong className="text-white">Desativado:</strong> Preserva a expressividade e sentimento original da performance humana.
                        </div>
                      </div>
                    </div>
                    <select
                      value={settings.quantize}
                      onChange={(e) => handleSliderChange('quantize', e.target.value)}
                      className="w-full bg-[#070A13] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer font-bold"
                    >
                      <option value="none">Desativado (Rico)</option>
                      <option value="1/4">1/4 Semínima</option>
                      <option value="1/8">1/8 Colcheia</option>
                      <option value="1/16">1/16 Semicolcheia</option>
                      <option value="1/32">1/32 Fusa</option>
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <label className="text-xs font-semibold text-slate-300 uppercase">BPM de Quant.</label>
                      <div className="relative group/tooltip">
                        <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-blue-400 transition-colors cursor-help" />
                        <div className="absolute bottom-full right-0 mb-2 w-72 p-3 bg-slate-950/95 border border-slate-800 rounded-xl text-slate-300 font-normal normal-case text-[11px] leading-relaxed shadow-2xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-200 z-50 pointer-events-none">
                          <span className="font-bold text-blue-400 block mb-1">Batidas por Minuto (Tempo):</span>
                          Ajusta a velocidade de referência do metrônomo para calcular o compasso de sincronização das notas.<br/>
                          • Deve bater com o andamento em que a aula de teclado foi gravada.
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="60"
                        max="240"
                        value={settings.bpm}
                        onChange={(e) => handleSliderChange('bpm', parseInt(e.target.value) || 120)}
                        className="flex-1 bg-[#070A13] border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-300 focus:outline-none focus:border-blue-500 font-bold"
                      />
                      <button
                        onClick={handleAutoDetectBPM}
                        disabled={notes.length < 5 || isTranscribing}
                        className="px-2.5 py-1 text-[10px] font-bold bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 hover:border-blue-500/40 rounded transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed select-none active:scale-[0.98]"
                        title="Calcular andamento automático a partir das notas já transcritas"
                      >
                        Autodetectar
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => triggerTranscription()}
                  disabled={!audioBuffer || isTranscribing}
                  className={`w-full mt-4 flex items-center justify-center gap-2 py-3 transition-all rounded-xl font-bold tracking-wide text-xs select-none disabled:bg-slate-800 disabled:text-slate-500 cursor-pointer disabled:shadow-none shadow-lg ${
                    isTranscribing
                      ? 'bg-slate-800 text-slate-500'
                      : !audioBuffer
                      ? 'bg-[#161B26] text-slate-550 border border-slate-800/40'
                      : hasPendingChanges
                      ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-amber-500/25 border border-amber-400/30 animate-pulse scale-[1.02]'
                      : 'bg-blue-600 hover:bg-blue-500 hover:scale-[1.01] text-white shadow-blue-500/20'
                  }`}
                >
                  <Cpu className="w-4 h-4" />
                  <span>{hasPendingChanges ? 'Aplicar Novos Parâmetros' : 'Analisar & Transcrever Áudio'}</span>
                </button>

                {/* Global Forced Snap-to-Grid and Pitch correction */}
                <div className="mt-4 pt-4 border-t border-slate-800/60 flex flex-col gap-2.5">
                  <button
                    onClick={handleForcedGlobalSnap}
                    disabled={notes.length === 0 || isTranscribing}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold tracking-wide text-xs transition-all duration-200 select-none cursor-pointer border ${
                      notes.length === 0
                        ? 'bg-[#070A13] border-slate-850/40 text-slate-550 cursor-not-allowed opacity-50'
                        : 'bg-[#10B981]/10 hover:bg-[#10B981]/20 active:bg-[#10B981]/30 border-[#10B981]/30 hover:border-[#10B981]/50 text-[#10B981] hover:scale-[1.01] shadow-lg shadow-[#10B981]/5'
                    }`}
                  >
                    <Sparkles className="w-4 h-4 text-[#10B981] shrink-0" />
                    <span>Forçar Snap de Afinação & Grid</span>
                  </button>
                  {snapSuccessMessage ? (
                    <div className="p-2.5 bg-[#10B981]/10 border border-[#10B981]/20 rounded-xl flex items-start gap-2 text-[11px] text-[#10B981] leading-normal">
                      <CheckCircle2 className="w-4.5 h-4.5 text-[#10B981] shrink-0 mt-0.5" />
                      <span>{snapSuccessMessage}</span>
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500 text-center leading-relaxed px-1">
                      Alinha automaticamente notas fora do ritmo e corrige/limpa pequenos ruídos e microtones desafinados após a transcrição original.
                    </p>
                  )}
                </div>

              </div>
            </div>

            {/* Export block */}
            {notes.length > 0 && (
              <div className="bg-[#0E131F] border border-slate-800 rounded-2xl p-5 shadow-xl">
                <h3 className="text-sm font-bold text-slate-200 mb-4 uppercase tracking-wider">Salvar e Exportar</h3>
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={handleDownloadMidi}
                    className="w-full flex items-center justify-center border-2 border-blue-500 hover:bg-blue-500/10 transition-colors py-3.5 rounded-xl text-blue-500 font-bold tracking-wide text-xs gap-2 cursor-pointer shadow-lg"
                  >
                    <Download className="w-4 h-4 stroke-[2.5]" />
                    <span>BAIXAR ARQUIVO .MID</span>
                  </button>
                  <p className="text-xs text-slate-400 text-center leading-relaxed mt-2">
                    Seu arquivo MIDI no formato padrão está pronto! Seguro para importar no Synthesia, Yousician ou qualquer DAW de áudio.
                  </p>
                </div>
              </div>
            )}

          </div>

          {/* RIGHT VIEWPORT WORKSPACE: Playback Wave, Piano Roll, virtual keys, AI Report */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            
            {!audioFile ? (
              // Empty State Welcome Canvas with step-by-step onboarding guide
              <div className="bg-[#0E131F]/40 border border-slate-800 rounded-3xl p-10 flex flex-col items-center justify-center text-center text-slate-500 min-h-[500px] shadow-2xl relative overflow-hidden group">
                {/* Decorative retro backdrop */}
                <div className="absolute inset-0 bg-radial-gradient from-blue-500/[0.02] to-transparent pointer-events-none"></div>
                
                <div className="p-6 rounded-full bg-[#070A13] border border-slate-800 mb-5 relative animate-bounce" style={{ animationDuration: '3s' }}>
                  <Music2 className="w-12 h-12 text-blue-500/40 group-hover:text-blue-500/80 transition-colors duration-300" />
                </div>
                
                <h2 className="text-xl font-extrabold text-white mb-3">Estúdio de Transcrição de Teclado</h2>
                <p className="text-sm text-slate-300 max-w-xl mx-auto leading-relaxed mt-1">
                  Seu laboratório inteligente de conversão está aguardando. Envie um áudio (.mp3 ou .wav) no painel esquerdo para começar a programar e visualizar o seu arquivo MIDI de aula de piano!
                </p>

                {/* Paso a paso onboarding */}
                <div className="mt-8 w-full max-w-3xl bg-[#070A13]/85 border border-[#1E293B] rounded-2xl p-6 text-left shadow-xl">
                  <h3 className="text-xs font-mono font-bold text-slate-400 mb-5 uppercase tracking-widest flex items-center gap-2 border-b border-slate-800/80 pb-3">
                    <Sparkles className="w-4 h-4 text-blue-400" />
                    COMO USAR O APP - PASSO A PASSO
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Passo 1 */}
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-mono font-bold text-xs select-none">
                        01
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">1. Subir Áudio</h4>
                        <p className="text-[11px] text-slate-400 mt-1 lines-2 leading-relaxed">
                          Arrastar e soltar ou clicar para selecionar um arquivo .mp3 ou .wav de piano no painel esquerdo.
                        </p>
                      </div>
                    </div>

                    {/* Passo 2 */}
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-mono font-bold text-xs select-none">
                        02
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">2. Transcrever</h4>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                          O app faz a varredura acústica de forma rápida e projeta as notas no Piano Roll e Teclado 3D de imediato.
                        </p>
                      </div>
                    </div>

                    {/* Passo 3 */}
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-mono font-bold text-xs select-none">
                        03
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">3. Dar Play</h4>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                          Clique em <span className="text-blue-400 font-bold">Play</span>! A música e o sintetizador digital tocam juntos com as teclas brilhando.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 pt-5 border-t border-slate-800/80">
                    {/* Passo 4 */}
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-mono font-bold text-xs select-none">
                        04
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">4. Mutar Fundo</h4>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                          Clique em <span className="text-blue-400 font-bold">Áudio Lógico/Mutado</span> para silenciar o barulho original e escutar apenas o piano limpo sintetizado.
                        </p>
                      </div>
                    </div>

                    {/* Passo 5 */}
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-mono font-bold text-xs select-none">
                        05
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">5. Refinar Filtros</h4>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                          Mude os "Parâmetros Finos" como limiar de ruído e clique em "Analisar" caso sua gravação tenha ruídos ou pedais sujos.
                        </p>
                      </div>
                    </div>

                    {/* Passo 6 */}
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-mono font-bold text-xs select-none">
                        06
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">6. Baixar MIDI</h4>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                          Diz "Baixar Arquivo .MID" para obter o arquivo totalmente compatível com Yousician, Synthesia ou qualquer DAW profissional!
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              // Active Loaded Session Layout
              <div className="flex flex-col gap-6">
                
                {/* Audio Wave player section & timeline */}
                <AudioWaveform
                  audioBuffer={audioBuffer}
                  currentTime={currentTime}
                  duration={duration}
                  onSeek={handleSeek}
                  isMuted={isMuted}
                  onMuteToggle={() => setIsMuted(!isMuted)}
                />

                {/* Main transport Control Bar */}
                <div className="flex items-center justify-between bg-[#0E131F] border border-slate-800 p-4 rounded-xl shadow-md gap-4">
                  <div className="flex items-center gap-2">
                    {/* Play / Pause */}
                    <button
                      onClick={togglePlay}
                      disabled={isTranscribing}
                      className={`flex items-center justify-center p-3 rounded-full transition-all cursor-pointer ${
                        isPlaying 
                          ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-md shadow-blue-500/20' 
                          : 'bg-indigo-600 text-white hover:bg-indigo-500 animate-pulse'
                      } disabled:opacity-40 disabled:pointer-events-none`}
                      title={isPlaying ? 'Pausar Áudio' : 'Reproduzir Áudio'}
                    >
                      {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                    </button>

                    {/* Rewind */}
                    <button
                      onClick={() => handleSeek(0)}
                      disabled={isTranscribing}
                      className="p-2.5 rounded-full border border-slate-800 hover:bg-slate-800/80 text-slate-400 hover:text-white cursor-pointer"
                      title="Voltar ao início"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Playback visual notes counts indicators */}
                  <div className="flex items-center gap-3">
                    <div className="h-6 w-[1.2px] bg-slate-850"></div>
                    <div className="bg-[#070A13] rounded-xl border border-slate-800 px-4 py-2 text-center select-none min-w-[120px]">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Notas Ativas</div>
                      <div className="text-sm font-bold text-blue-400">
                        {activeSynthNotes.size > 0 ? Array.from(activeSynthNotes).map(p => {
                          const label = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                          return label[Number(p) % 12];
                        }).join(', ') : '-'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Progress Circle overlay when converting */}
                {isTranscribing && notes.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 px-6 bg-[#0E131F] border border-slate-800 rounded-2xl shadow-xl">
                    <div className="relative flex items-center justify-center mb-6">
                      <div className="w-16 h-16 rounded-full border-4 border-slate-850 border-t-blue-500 animate-spin"></div>
                      <div className="absolute text-sm font-bold text-blue-400">{transcriptionProgress}%</div>
                    </div>
                    <h3 className="text-sm font-bold text-slate-100">{transcriptionStatus}</h3>
                    <p className="text-xs text-slate-300 max-w-sm text-center mt-2 leading-relaxed">
                      Utilizando algoritmos de Direct-DFT de Comb de 88 filtros acústicos de piano. Isso garante um arquivo MIDI preciso para sua pauta.
                    </p>
                  </div>
                )}

                {/* Mapped notes grid roll if completed */}
                {notes.length > 0 && (
                  <div className={`flex flex-col gap-6 relative transition-all duration-300 ${isTranscribing ? 'opacity-70 pointer-events-none' : ''}`}>
                    
                    {/* METHOD CONTROLLER: Hands and Difficulty Simulator */}
                    <div className="bg-[#0E131F] border border-slate-800 rounded-2xl p-5 shadow-xl select-none">
                      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-800/50">
                        <div className="flex items-center space-x-3">
                          <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl border border-blue-500/20">
                            <Keyboard className="w-5 h-5 text-blue-500 animate-pulse" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-widest">Opções de Prática (Método Teclado)</h3>
                            <p className="text-[11px] text-slate-400">Configure as preferências de treinamento e baixe o arquivo MIDI adequado para o seu app</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isTranscribing ? (
                            <div className="flex items-center gap-2.5 px-3.5 py-2 text-xs font-bold bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400 select-none animate-pulse">
                              <span className="w-2.5 h-2.5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin shrink-0"></span>
                              <span>Sincronizando ({transcriptionProgress}%)</span>
                            </div>
                          ) : (
                            <button
                              onClick={handleDownloadMidi}
                              className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold bg-[#070A13] hover:bg-slate-800 border border-slate-855 rounded-xl text-slate-200 transition cursor-pointer shadow-lg"
                            >
                              <Download className="w-4 h-4 text-blue-400 shrink-0" />
                              <span>Exportar MIDI Customizado</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4">
                        {/* Mão de Treino Selector */}
                        <div>
                          <div className="flex items-center gap-1.5 mb-2.5">
                            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Mão de Treino</span>
                            <div className="relative group/tooltip">
                              <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-blue-400 transition-colors cursor-help" />
                              <div className="absolute bottom-full left-0 mb-2 w-72 p-3 bg-slate-950/95 border border-slate-800 rounded-xl text-slate-300 font-normal text-[11px] leading-relaxed shadow-2xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-200 z-50 pointer-events-none normal-case">
                                <span className="font-bold text-blue-400 block mb-1">Como dividir as mãos do estudante:</span>
                                • <strong className="text-white">Ambas as Mãos:</strong> Mantém todas as notas, coloridas de forma inteligente. Mão Direita em Âmbar e Mão Esquerda em Azul.<br/>
                                • <strong className="text-white">Só Direita (Melodia):</strong> Muta e filtra todos os baixos. Foca apenas nas notas agudas acima de C4 (Dó Central).<br/>
                                • <strong className="text-white">Só Esquerda (Baixo):</strong> Muta e filtra a melodia para focar apenas nas notas graves abaixo de C4.
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2 bg-[#070A13] p-1 rounded-xl border border-slate-800">
                            <button
                              onClick={() => setTrainingHand('both')}
                              className={`py-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                                trainingHand === 'both'
                                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow shadow-indigo-600/20'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                            >
                              Ambas as Mãos
                            </button>
                            <button
                              onClick={() => setTrainingHand('right')}
                              className={`py-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                                trainingHand === 'right'
                                  ? 'bg-amber-500 text-white shadow shadow-amber-500/20'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-850/40'
                              }`}
                            >
                              Só Direita (Treble)
                            </button>
                            <button
                              onClick={() => setTrainingHand('left')}
                              className={`py-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                                trainingHand === 'left'
                                  ? 'bg-blue-500 text-white shadow shadow-blue-500/20'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-850/40'
                              }`}
                            >
                              Só Esquerda (Bass)
                            </button>
                          </div>
                        </div>

                        {/* Dificuldade de Leitura */}
                        <div>
                          <div className="flex items-center gap-1.5 mb-2.5">
                            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Dificuldade da Partitura</span>
                            <div className="relative group/tooltip">
                              <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-blue-400 transition-colors cursor-help" />
                              <div className="absolute bottom-full right-0 mb-2 w-72 p-3 bg-slate-950/95 border border-slate-800 rounded-xl text-slate-300 font-normal text-[11px] leading-relaxed shadow-2xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-200 z-50 pointer-events-none normal-case">
                                <span className="font-bold text-blue-400 block mb-1">Simplificação inteligente para alunos:</span>
                                • <strong className="text-white">Jeito Normal:</strong> Exporta a transcrição e acordes originais exatamente como dedilhados pelo instrumentista.<br/>
                                • <strong className="text-white">Jeito Facilitado:</strong> Simplifica a harmonia agrupando notas consecutivas em tríades limpas/tônicas fundamentais e isola uma linha clara de melodia monofônica na mão direita, facilitando para iniciantes.
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 bg-[#070A13] p-1 rounded-xl border border-slate-800">
                            <button
                              onClick={() => setPracticeDifficulty('normal')}
                              className={`py-2 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                                practiceDifficulty === 'normal'
                                  ? 'bg-blue-600 text-white shadow shadow-blue-600/20'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-850/45'
                              }`}
                            >
                              Jeito Normal (Original)
                            </button>
                            <button
                              onClick={() => setPracticeDifficulty('simplified')}
                              className={`py-2 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                                practiceDifficulty === 'simplified'
                                  ? 'bg-amber-550 text-white bg-amber-500 shadow shadow-amber-500/20'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-855/45'
                              }`}
                            >
                              Jeito Facilitado (Simplificado)
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Render Piano Roll Canvas */}
                    <PianoRoll
                      notes={processedNotes}
                      duration={duration}
                      currentTime={currentTime}
                      onSeek={handleSeek}
                      bpm={settings.bpm}
                    />

                    {/* Virtual Interactive Keyboard */}
                    <VirtualKeyboard 
                      activeNotes={activeSynthNotes} 
                    />

                    {/* AI Scales & Chords Tutor Analysis */}
                    <div className="flex flex-col bg-[#0E131F] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
                      <div className="flex items-center justify-between bg-[#070A13] px-5 py-4 border-b border-slate-800">
                        <div className="flex items-center space-x-2.5">
                          <Sparkles className="w-5 h-5 text-blue-500" />
                          <div>
                            <h3 className="text-sm font-bold text-slate-200 tracking-wider">Tutor Inteligente de Teclado (Gemini)</h3>
                            <p className="text-xs text-slate-400">Dedução de escala harmônica, acordes e dicas de digitação prática</p>
                          </div>
                        </div>

                        {!aiReport && (
                          <button
                            onClick={handleAnalyzeWithAI}
                            disabled={isAiLoading || notes.length === 0}
                            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#070A13] border border-slate-800 hover:bg-slate-800 hover:border-slate-700 text-blue-400 transition cursor-pointer select-none disabled:opacity-40"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Analisar Música</span>
                          </button>
                        )}
                      </div>

                      {/* AI Response Block */}
                      <div className="p-5">
                        {isAiLoading && (
                          <div className="flex flex-col items-center justify-center py-8">
                            <div className="w-8 h-8 rounded-full border-2 border-slate-800 border-t-blue-500 animate-spin mb-3"></div>
                            <span className="text-xs text-slate-300">Gemini analisando a harmonia e gerando o plano de digitação...</span>
                          </div>
                        )}

                        {aiError && (
                          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 p-4 rounded-xl text-red-400">
                            <AlertCircle className="w-5 h-5 flex-shrink-0" />
                            <div>
                              <h4 className="text-xs font-bold leading-none">Mapeador Gemini Falhou</h4>
                              <p className="text-xs mt-1 leading-relaxed opacity-90">{aiError}</p>
                            </div>
                          </div>
                        )}

                        {!isAiLoading && !aiReport && !aiError && (
                          <div className="text-center py-6">
                            <p className="text-sm text-slate-300">
                              Dúvidas de qual é a escala ou de como praticar essa música no teclado?
                              Utilize o botão <span className="text-blue-400 font-extrabold text-sm border-b border-blue-500/30">Analisar Música</span> para receber uma orientação direta via IA!
                            </p>
                          </div>
                        )}

                        {aiReport && (
                          <div className="flex flex-col gap-6">
                            {/* Card grid metrics */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              
                              {/* Scale */}
                              <div className="bg-[#070A13] p-4.5 rounded-xl border border-slate-800">
                                <span className="text-xs text-slate-400 block uppercase tracking-wider font-semibold">Escala / Tom</span>
                                <span className="text-base font-bold text-blue-400 mt-1 block">{aiReport.escala}</span>
                              </div>

                              {/* Difficulty */}
                              <div className="bg-[#070A13] p-4.5 rounded-xl border border-slate-800">
                                <span className="text-xs text-slate-400 block uppercase tracking-wider font-semibold">Dificuldade Classificada</span>
                                <span className="text-base font-bold text-emerald-400 mt-1 block">{aiReport.dificuldade}</span>
                              </div>

                              {/* BPM estimated */}
                              <div className="bg-[#070A13] p-4.5 rounded-xl border border-slate-800">
                                <span className="text-xs text-slate-400 block uppercase tracking-wider font-semibold">BPM Definido</span>
                                <span className="text-base font-bold text-slate-200 mt-1 block">{settings.bpm} BPM</span>
                              </div>

                            </div>

                            {/* Estimated Chords */}
                            {aiReport.acordes && aiReport.acordes.length > 0 && (
                              <div className="bg-[#070A13] border border-slate-800 rounded-xl p-5">
                                <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block mb-3">Harmonia e Acordes Estimados</span>
                                <div className="flex flex-wrap gap-2.5">
                                  {aiReport.acordes.map((chord: string, idx: number) => (
                                    <span 
                                      key={idx} 
                                      className="px-4 py-2 rounded-lg border border-slate-800 bg-[#0E131F] font-bold text-white text-xs text-center min-w-[55px] hover:border-blue-500/30 transition-all select-none"
                                    >
                                      {chord}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Summary description */}
                            {aiReport.resumoMusica && (
                              <div className="bg-[#070A13] border border-slate-800 rounded-xl p-5">
                                <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block mb-2">Resumo Estrutural Harmônico</span>
                                <p className="text-sm text-slate-300 leading-relaxed">
                                  {aiReport.resumoMusica}
                                </p>
                              </div>
                            )}

                            {/* Dynamic Keyboard Lesson guides */}
                            {aiReport.dicas && aiReport.dicas.length > 0 && (
                              <div>
                                <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block mb-3">Dicas Técnicas para Treino do Peça</span>
                                <div className="flex flex-col gap-3">
                                  {aiReport.dicas.map((tip: string, idx: number) => (
                                    <div 
                                      key={idx} 
                                      className="flex items-start gap-4 bg-[#070A13] border border-slate-800 p-4 rounded-xl leading-relaxed text-sm"
                                    >
                                      <div className="p-2 rounded-lg bg-[#0E131F] border border-slate-800 text-blue-400 font-extrabold text-xs mt-0.5 leading-none">
                                        {idx + 1}
                                      </div>
                                      <p className="text-slate-200 flex-1 leading-relaxed">
                                        {tip}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="text-xs text-slate-500 italic text-right">
                              Análise gerada de forma dinâmica utilizando Inteligência Artificial (Gemini).
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                )}

              </div>
            )}

          </div>

        </div>
      </main>
    </div>
  );
}
