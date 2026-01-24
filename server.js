
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';
import * as esbuild from 'esbuild';

// IMPORTAÇÃO DOS PRESETS
import { getMovementFilter } from './presets/movements.js';
import { buildTransitionFilter, getTransitionXfade } from './presets/transitions.js';
import { getFFmpegFilterFromEffect } from './presets/effects.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

[UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ARGUMENTOS DE VÍDEO PADRÃO (Otimizados para compatibilidade)
const getVideoArgs = () => [
    '-c:v', 'libx264',
    '-preset', 'ultrafast', // Rápido para preview
    '-tune', 'zerolatency',
    '-profile:v', 'main', 
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-r', '24' 
];

// ARGUMENTOS DE ÁUDIO PADRÃO (AAC Stereo 44.1k)
const getAudioArgs = () => [
    '-c:a', 'aac',
    '-b:a', '192k', 
    '-ar', '44100',
    '-ac', '2' // Força Stereo
];

// Função auxiliar para normalizar áudio dentro do filter_complex
// Converte qualquer input para Stereo 44100Hz para evitar falhas no amix
const normalizeAudio = (labelIn, labelOut) => {
    return `${labelIn}aformat=sample_rates=44100:channel_layouts=stereo[${labelOut}]`;
};

// PROBE: Obtém a duração exata do arquivo de mídia no disco
const getExactDuration = (filePath) => {
    return new Promise((resolve) => {
        execFile(ffprobePath.path, [
            '-v', 'error', 
            '-show_entries', 'format=duration', 
            '-of', 'default=noprint_wrappers=1:nokey=1', 
            filePath
        ], (err, stdout) => {
            if (err) {
                console.error("Erro no probe:", err);
                resolve(0);
            } else {
                const dur = parseFloat(stdout);
                resolve(isNaN(dur) ? 0 : dur);
            }
        });
    });
};

async function buildFrontend() {
    try {
        if (fs.existsSync('index.html')) fs.copyFileSync('index.html', path.join(PUBLIC_DIR, 'index.html'));
        if (fs.existsSync('index.css')) fs.copyFileSync('index.css', path.join(PUBLIC_DIR, 'index.css'));
        await esbuild.build({
            entryPoints: ['index.tsx'],
            bundle: true,
            outfile: path.join(PUBLIC_DIR, 'bundle.js'),
            format: 'esm',
            target: ['es2020'],
            minify: true,
            external: ['fs', 'path', 'child_process', 'url', 'https', 'ffmpeg-static', 'ffprobe-static'],
            define: { 'process.env.API_KEY': JSON.stringify(GEMINI_KEY), 'global': 'window' },
            loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
        });
    } catch (e) { console.error(e); }
}
await buildFrontend();

app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/outputs', express.static(OUTPUT_DIR));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9_.]/g, '_')}`)
});
const uploadAny = multer({ storage }).any();

const jobs = {};

// --- SUBTITLE STYLES ---
const FONTS = { Impact: 'Impact', Arial: 'Arial' };
const BASE = "FontSize=24,Bold=1,Alignment=2,MarginV=50";
const SUBTITLE_STYLES = {
    'viral_yellow': `Fontname=Impact,${BASE},PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0`
};

function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return (parseFloat(parts[0]) * 3600) + (parseFloat(parts[1]) * 60) + parseFloat(parts[2]);
}

function formatSrtTime(seconds) {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const iso = date.toISOString();
    return iso.substr(11, 8) + ',' + iso.substr(20, 3);
}

function runFFmpeg(args, jobId) {
    return new Promise((resolve, reject) => {
        const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
        let stderr = '';
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
            if (code === 0) resolve();
            else {
                console.error(`FFmpeg Error Job ${jobId}:`, stderr);
                reject(new Error(stderr));
            }
        });
    });
}

async function handleExport(job, uploadDir, callback) {
    const outputName = `render_${job.id}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    
    const transition = job.params?.transition || 'cut'; 
    const movement = job.params?.movement || 'static';
    const renderSubtitles = job.params?.renderSubtitles === 'true';
    const subtitleStyleKey = job.params?.subtitleStyle || 'viral_yellow';
    const aspectRatio = job.params?.aspectRatio || '16:9';

    let targetW = 1280;
    let targetH = 720;
    if (aspectRatio === '9:16') {
        targetW = 720;
        targetH = 1280;
    }

    let scenesData = [];
    try { if (job.params?.scenesData) scenesData = JSON.parse(job.params.scenesData); } catch(e) {}

    try {
        const sceneMap = {};
        let bgMusicFile = null;

        // Mapear arquivos enviados
        job.files.forEach(f => {
            if (f.originalname.includes('background_music')) {
                bgMusicFile = f;
            } else {
                const match = f.originalname.match(/scene_(\d+)_(visual|audio|sfx)/);
                if (match) {
                    const idx = parseInt(match[1]);
                    const type = match[2];
                    if (!sceneMap[idx]) sceneMap[idx] = {};
                    sceneMap[idx][type] = f;
                }
            }
        });

        const sortedScenes = Object.keys(sceneMap).sort((a,b) => a - b).map(k => sceneMap[k]);
        const clipPaths = [];
        const videoClipDurations = []; 

        const transitionDuration = transition === 'cut' ? 0 : 1.0;
        // Padding extra para transições
        const padding = transition === 'cut' ? 0 : transitionDuration; 

        // PASSO 1: GERAR CLIPES INDIVIDUAIS (Normalizando áudio aqui)
        for (let i = 0; i < sortedScenes.length; i++) {
            const scene = sortedScenes[i];
            
            if(jobs[job.id]) {
                const percentPerScene = 75 / (sortedScenes.length || 1);
                jobs[job.id].progress = Math.floor(5 + (i * percentPerScene));
            }

            const clipPath = path.join(uploadDir, `temp_clip_${job.id}_${i}.mp4`);
            const args = [];
            
            // Duração baseada no áudio (TTS)
            let exactAudioDuration = scenesData[i]?.duration || 5;
            if (scene.audio) {
                const probeDur = await getExactDuration(scene.audio.path);
                if (probeDur > 0) exactAudioDuration = probeDur;
            }

            const totalClipDuration = padding + exactAudioDuration + padding;
            videoClipDurations.push(totalClipDuration);

            // Filtro de Movimento (Zoom/Pan)
            const moveFilter = getMovementFilter(movement, totalClipDuration + 2.0, targetW, targetH);
            const delayMs = Math.floor(padding * 1000); // Delay em ms para o áudio começar na hora certa
            
            // --- CONSTRUÇÃO DO FILTER COMPLEX ---
            let filterComplex = "";
            let inputCount = 0;

            // 1. INPUT VISUAL (0)
            if (scene.visual) {
                if (scene.visual.mimetype.includes('image')) {
                    args.push('-framerate', '24', '-loop', '1', '-i', scene.visual.path);
                } else {
                    args.push('-stream_loop', '-1', '-i', scene.visual.path);
                }
                inputCount++; // Index 0
            } else {
                // Fallback preto
                args.push('-f', 'lavfi', '-i', `color=c=black:s=${targetW}x${targetH}:d=${totalClipDuration}`);
                inputCount++;
            }

            // 2. INPUT ÁUDIO TTS (1)
            let hasVoice = false;
            if (scene.audio) {
                args.push('-i', scene.audio.path);
                hasVoice = true;
                inputCount++; // Index 1
            } else {
                args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
                inputCount++; // Index 1 (silêncio)
            }

            // 3. INPUT SFX (2)
            let hasSfx = false;
            if (scene.sfx) {
                args.push('-i', scene.sfx.path);
                hasSfx = true;
                inputCount++; // Index 2
            }

            // --- LÓGICA DE MIXAGEM ---
            
            // Visual Filter chain
            filterComplex += `[0:v]${moveFilter}[v_out];`;

            // Áudio Filter chain
            // Normalizar TTS
            filterComplex += `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=1.5[voice_norm];`;
            
            let audioMixNode = `[voice_norm]`;

            if (hasSfx) {
                // Normalizar SFX
                filterComplex += `[2:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=0.6[sfx_norm];`;
                // Mixar
                filterComplex += `[voice_norm][sfx_norm]amix=inputs=2:duration=first:dropout_transition=0[mix1];`;
                audioMixNode = `[mix1]`;
            }

            // Aplicar Delay (Padding) e Pad (para preencher vídeo)
            const audioFinalNode = `[a_final]`;
            const delayFilter = delayMs > 0 ? `adelay=${delayMs}|${delayMs},` : '';
            filterComplex += `${audioMixNode}${delayFilter}apad[a_padded];[a_padded]atrim=0:${totalClipDuration}${audioFinalNode}`;

            // --- EXECUTAR FFMPEG CENA ---
            const finalSceneArgs = [
                ...args,
                '-filter_complex', filterComplex,
                '-map', '[v_out]',
                '-map', audioFinalNode,
                '-t', totalClipDuration.toFixed(3),
                ...getVideoArgs(),
                ...getAudioArgs(),
                clipPath
            ];

            await runFFmpeg(finalSceneArgs, job.id);
            clipPaths.push(clipPath);
        }

        // PASSO 2: LEGENDAS
        let srtPath = "";
        let forceStyle = SUBTITLE_STYLES[subtitleStyleKey] || SUBTITLE_STYLES['viral_yellow'];

        if (renderSubtitles && scenesData.length > 0) {
            let srtContent = "";
            let globalTimelineCursor = 0; 
            
            for(let idx = 0; idx < scenesData.length; idx++) {
                const sd = scenesData[idx];
                const realAudioDuration = videoClipDurations[idx] - (padding * 2); 
                
                if (sd.narration) {
                    const startTime = globalTimelineCursor + padding;
                    const endTime = startTime + realAudioDuration;
                    srtContent += `${idx + 1}\n${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}\n${sd.narration}\n\n`;
                }
                
                globalTimelineCursor += (videoClipDurations[idx] - transitionDuration);
            }
            
            srtPath = path.join(uploadDir, `subs_${job.id}.srt`);
            fs.writeFileSync(srtPath, srtContent);
        }

        // PASSO 3: CONCATENAÇÃO FINAL COM MÚSICA
        if(jobs[job.id]) jobs[job.id].progress = 80;

        let finalArgs = [];
        const absoluteSrtPath = srtPath ? path.resolve(srtPath).split(path.sep).join('/').replace(/:/g, '\\:') : "";
        const hasBgMusic = !!bgMusicFile;

        // Se usar CUT, usamos concat demuxer (mais rápido e seguro)
        if (transition === 'cut' || clipPaths.length === 1) {
            const listPath = path.join(uploadDir, `concat_list_${job.id}.txt`);
            fs.writeFileSync(listPath, clipPaths.map(p => `file '${path.resolve(p).split(path.sep).join('/')}'`).join('\n'));

            // Input 0: Concat List
            let inputsArgs = ['-f', 'concat', '-safe', '0', '-i', listPath];
            let filterComplex = "";
            let mapArgs = [];

            // Input 1: Música (Se houver)
            if (hasBgMusic) {
                // IMPORTANTE: -stream_loop -1 deve vir ANTES do -i
                inputsArgs.push('-stream_loop', '-1', '-i', bgMusicFile.path);
            }

            // Filtros de Vídeo (Legendas)
            if (renderSubtitles && srtPath) {
                filterComplex += `[0:v]subtitles='${absoluteSrtPath}':force_style='${forceStyle}'[v_out];`;
                mapArgs.push('-map', '[v_out]');
            } else {
                mapArgs.push('-map', '0:v');
            }

            // Filtros de Áudio (Mix Música)
            if (hasBgMusic) {
                // Normalizar canais antes do mix final
                filterComplex += `[0:a]aformat=sample_rates=44100:channel_layouts=stereo[main_a];`;
                filterComplex += `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=0.2[bgm];`;
                filterComplex += `[main_a][bgm]amix=inputs=2:duration=first:dropout_transition=0[a_out]`;
                mapArgs.push('-map', '[a_out]');
            } else {
                mapArgs.push('-map', '0:a');
            }

            if (filterComplex) {
                finalArgs = [...inputsArgs, '-filter_complex', filterComplex, ...mapArgs, ...getVideoArgs(), ...getAudioArgs(), outputPath];
            } else {
                finalArgs = [...inputsArgs, ...mapArgs, ...getVideoArgs(), ...getAudioArgs(), outputPath];
            }

        } else {
            // XFADE TRANSITIONS
            const inputs = []; 
            clipPaths.forEach(p => inputs.push('-i', p));
            
            if (hasBgMusic) {
                inputs.push('-stream_loop', '-1', '-i', bgMusicFile.path);
            }
            
            let { filterComplex: transFilter, mapArgs } = buildTransitionFilter(clipPaths.length, transition, videoClipDurations, transitionDuration);
            
            // O buildTransitionFilter retorna o grafo de transição. Precisamos interceptar o output dele.
            // mapArgs[1] é o label de vídeo final (ex: [v4]), mapArgs[3] é o áudio final (ex: [a4])
            const lastVLabel = mapArgs[1]; 
            const lastALabel = mapArgs[3]; 
            
            let finalVLabel = lastVLabel;
            let finalALabel = lastALabel;

            // Add Subtitles
            if (renderSubtitles && srtPath) {
                const subLabel = `[v_subs]`;
                transFilter += `;${lastVLabel}subtitles='${absoluteSrtPath}':force_style='${forceStyle}'${subLabel}`;
                finalVLabel = subLabel;
            }

            // Add Music Mix
            if (hasBgMusic) {
                const bgmIndex = clipPaths.length; // Música é o último input
                const mixedLabel = `[a_mixed]`;
                transFilter += `;[${bgmIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=0.2[bgm];${lastALabel}aformat=sample_rates=44100:channel_layouts=stereo[main_a];[main_a][bgm]amix=inputs=2:duration=first:dropout_transition=0${mixedLabel}`;
                finalALabel = mixedLabel;
            }
            
            finalArgs = [...inputs, '-filter_complex', transFilter, '-map', finalVLabel, '-map', finalALabel, ...getVideoArgs(), ...getAudioArgs(), outputPath];
        }

        const totalEstimated = scenesData.reduce((acc, s) => acc + (s.duration || 5), 0);
        callback(job.id, finalArgs, totalEstimated);
        
        // Limpeza (após 5 min)
        setTimeout(() => {
            clipPaths.forEach(p => fs.unlink(p, () => {}));
            if(srtPath) fs.unlink(srtPath, () => {});
        }, 300000); 

    } catch (e) { 
        console.error("ERRO CRÍTICO NO EXPORT:", e); 
        if (jobs[job.id]) {
            jobs[job.id].status = 'failed'; 
            jobs[job.id].error = e.message; 
        }
    }
}

function createFFmpegJob(jobId, args, expectedDuration, res) {
    jobs[jobId].status = 'processing';
    if (res && !res.headersSent) res.status(202).json({ jobId });
    
    const ffmpeg = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-stats', '-y', ...args]);
    
    ffmpeg.stderr.on('data', d => {
        const line = d.toString();
        // Progresso baseado no tempo
        const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
        if (timeMatch && expectedDuration > 0) {
            const cur = timeToSeconds(timeMatch[1]);
            let p = Math.round((cur / expectedDuration) * 20); 
            // Os últimos 20% são do passo final
            if (jobs[jobId]) jobs[jobId].progress = Math.min(99, 80 + p);
        }
    });

    ffmpeg.on('close', code => {
        if (!jobs[jobId]) return;
        if (code === 0) {
            jobs[jobId].status = 'completed';
            jobs[jobId].progress = 100;
            jobs[jobId].downloadUrl = `/outputs/${path.basename(args[args.length - 1])}`;
        } else {
            console.error(`FFmpeg falhou (Código ${code})`);
            jobs[jobId].status = 'failed';
            jobs[jobId].error = "Erro na renderização final.";
        }
    });
}

app.post('/api/process/start/:action', uploadAny, (req, res) => {
    const action = req.params.action;
    const jobId = `${action}_${Date.now()}`;
    jobs[jobId] = { id: jobId, status: 'pending', progress: 0, files: req.files, params: req.body, downloadUrl: null };
    res.status(202).json({ jobId });
});

app.post('/api/export/start', uploadAny, (req, res) => {
    const jobId = `export_${Date.now()}`;
    jobs[jobId] = { id: jobId, status: 'processing', progress: 5, files: req.files, params: req.body, downloadUrl: null };
    res.status(202).json({ jobId });
    handleExport(jobs[jobId], UPLOAD_DIR, (id, args, dur) => createFFmpegJob(id, args, dur, null));
});

app.get('/api/process/status/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job) return res.status(404).json({ status: 'not_found' });
    res.json(job);
});

app.get('/api/process/download/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (job && job.downloadUrl) return res.redirect(job.downloadUrl);
    res.status(404).send("File not found");
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server online on port ${PORT}`));
