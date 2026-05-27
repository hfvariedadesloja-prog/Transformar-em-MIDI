/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for parsing json requests
  app.use(express.json({ limit: '10mb' }));

  // Initialize Gemini Client with standard headers for telemetry tracking
  // Using gemini-3.5-flash for efficient, fast basic text reasoning
  const apiKey = process.env.GEMINI_API_KEY;
  let ai: GoogleGenAI | null = null;
  
  if (apiKey) {
    ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }

  // API endpoint for note musicology and keyboard lesson analysis
  app.post('/api/analyze-music', async (req, res) => {
    try {
      if (!ai) {
        return res.status(503).json({
          error: 'Serviço temporariamente indisponível. Por favor, adicione sua GEMINI_API_KEY nas Configurações (Secrets).'
        });
      }

      const { notes, bpm, filename } = req.body;
      if (!notes || !Array.isArray(notes)) {
        return res.status(400).json({ error: "Faltando notas MIDI válidas para análise." });
      }

      // Prepare a highly concise summary of onset events for Gemini to keep execution lightning-fast
      const notesSorted = [...notes].sort((a, b) => a.startTime - b.startTime);
      const firstNotes = notesSorted.slice(0, 120).map(note => ({
        p: note.pitch,
        s: parseFloat(note.startTime.toFixed(2)),
        e: parseFloat(note.endTime.toFixed(2))
      }));

      const prompt = `Você é um tutor de teclado profissional e musicologista especialista em transcrições MIDI.
Analise a seguinte sequência de eventos de notas MIDI extraídos de um arquivo de áudio (${filename || 'Áudio Transgredido'}), com BPM estimado de ${bpm} BPM:
${JSON.stringify(firstNotes)}

Com base nestes dados (pitch representa teclas do piano, onde 60 é Dó Central, e frações representam segundos):
1. Estime qual a escala/tom musical principal da música (ex: "Dó Maior", "Lá Menor", "Fá Sustenido Menor").
2. Deduza os prováveis acordes formados no trecho (ex: "C, G, Am, F").
3. Classifique a dificuldade para praticar essa música no teclado (Iniciante, Intermediário, Avançado). Justifique de forma simples.
4. Redija exatamente três dicas de digitação prática ou técnica de mãos (esquerda/direita) no teclado para tocar esse trecho baseando-se nas notas identificadas.

Retorne SOMENTE o código JSON estruturado exatamente de acordo com esta especificação:
{
  "escala": "Nome da escala detalhada",
  "acordes": ["Acorde A", "Acorde B", "Acorde C", "Acorde D"],
  "dificuldade": "Iniciante, Intermediário ou Avançado com frase rápida explicativa",
  "dicas": ["Primeira dica técnica de teclado", "Segunda dica de posicionamento de mãos", "Terceira dica de digitação e saltos de acordes"],
  "resumoMusica": "Breve parágrafo explicativo descrevendo harmonicamente o que foi detectado no teclado."
}

NÃO adicione blocos de código markdown ou aspas triplas \`\`\`. Retorne apenas chaves francesas de JSON puro.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        }
      });

      const rawText = response.text || '{}';
      const parsedData = JSON.parse(rawText.trim());
      
      res.json(parsedData);
    } catch (err: any) {
      console.error('Falha na resposta do tutor Gemini:', err);
      res.status(500).json({
        error: 'Erro ao conectar à inteligência musical do Gemini.',
        details: err.message || 'Erro inesperado'
      });
    }
  });

  // Setup Vite Middleware based on environments to sustain both developer edits and raw production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Vite middleware mounted for local dev server.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('Static asset server mounted for production.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Express dev server running on port ${PORT}`);
  });
}

startServer();
