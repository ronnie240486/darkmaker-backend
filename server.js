
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
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

const getVideoArgs = () => [
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-r', '30'
];

const getAudioArgs = () => [
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '44100'
];

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

// --- SUBTITLE STYLES ENGINE (Expandido) ---
const BASE_STYLE = "FontSize=24,Bold=1,Alignment=2,MarginV=50";
const COLORS = {
    Yellow: '&H00FFFF00', Green: '&H0000FF00', Red: '&H000000FF', Cyan: '&H00FFFF00', 
    White: '&H00FFFFFF', Black: '&H00000000', Orange: '&H0000A5FF', Pink: '&H009314FF',
    Purple: '&H00800080', Blue: '&H00FF0000', Gold: '&H0000D7FF', Grey: '&H00E0E0E0'
};

const SUBTITLE_STYLES = {
    // VIRAL
    'viral_yellow': `Fontname=Impact,${BASE_STYLE},PrimaryColour=${COLORS.Yellow},OutlineColour=${COLORS.Black},BorderStyle=1,Outline=2,Shadow=0`,
    'viral_green': `Fontname=Impact,${BASE_STYLE},PrimaryColour=${COLORS.Green},OutlineColour=${COLORS.Black},BorderStyle=1,Outline=2,Shadow=0`,
    'viral_red': `Fontname=Impact,${BASE_STYLE},PrimaryColour=${COLORS.Red},OutlineColour=${COLORS.White},BorderStyle=1,Outline=2,Shadow=0`,
    'viral_orange': `Fontname=Impact,${BASE_STYLE},PrimaryColour=${COLORS.Orange},OutlineColour=${COLORS.Black},BorderStyle=1,Outline=2,Shadow=0`,
    'viral_white_black': `Fontname=Impact,${BASE_STYLE},PrimaryColour=${COLORS.White},OutlineColour=${COLORS.Black},BorderStyle=1,Outline=3,Shadow=2`,
    'viral_cyan': `Fontname=Impact,${BASE_STYLE},PrimaryColour=${COLORS.Cyan},OutlineColour=${COLORS.Black},BorderStyle=1,Outline=2,Shadow=0`,
    
    // CLEAN
    'clean_white': `Fontname=Arial,${BASE_STYLE},PrimaryColour=${COLORS.White},OutlineColour=${COLORS.Black},BorderStyle=1,Outline=1,Shadow=1`,
    'clean_yellow': `Fontname=Arial,${BASE_STYLE},PrimaryColour=${COLORS.Yellow},OutlineColour=${COLORS.Black},BorderStyle=1,Outline=1,Shadow=0`,
    'clean_black': `Fontname=Arial,${BASE_STYLE},PrimaryColour=${COLORS.Black},OutlineColour=${COLORS.White},BorderStyle=1,Outline=1,Shadow=0`,
    'minimal_grey': `Fontname=Helvetica,${BASE_STYLE},PrimaryColour=${COLORS.Grey},OutlineColour=${COLORS.Black},BorderStyle=1,Outline=1,Shadow=0`,
    
    // BOXED
    'box_black_white': `Fontname=Arial,${BASE_STYLE},PrimaryColour=${COLORS.White},BackColour=&H80000000,BorderStyle=3,Outline=0,Shadow=0`,
    'box_white_black': `Fontname=Arial,${BASE_STYLE},PrimaryColour=${COLORS.Black},BackColour=&H80FFFFFF,BorderStyle=3,Outline=0,Shadow=0`,
    'box_yellow_black': `Fontname=Arial,${BASE_STYLE},PrimaryColour=${COLORS.Yellow},BackColour=&H80000000,BorderStyle=3,Outline=0,Shadow=0`,
    'box_red_white': `Fontname=Arial,${BASE_STYLE},PrimaryColour=${COLORS.White},BackColour=&H600000FF,BorderStyle=3,Outline=0,Shadow=0`,
    
    // NEON & STYLIZED
    'neon_cyan': `Fontname=Arial,${BASE_STYLE},PrimaryColour=${COLORS.Cyan},OutlineColour=${COLORS.Blue},BorderStyle=1,Outline=2,Shadow=0`,
    'neon_pink': `Fontname=Arial,${BASE_STYLE},PrimaryColour=${COLORS.Pink},OutlineColour=${COLORS.Purple},BorderStyle=1,Outline=2,Shadow=0`,
    'neon_green': `Fontname=Arial,${BASE_STYLE},PrimaryColour=${COLORS.Green},OutlineColour=${COLORS.Green},BorderStyle=1,Outline=1,Shadow=0`,
    'gaming_bold': `Fontname=Verdana,${BASE_STYLE},PrimaryColour=${COLORS.Green},OutlineColour=${COLORS.Black},BorderStyle=1,Outline=3,Shadow=0`,
    'gaming_purple': `Fontname=Verdana,${BASE_STYLE},PrimaryColour=${COLORS.White},OutlineColour=${COLORS.Purple},BorderStyle=1,Outline=3,Shadow=0`,
    
    // CINEMATIC
    'cine_serif_white': `Fontname=Times New Roman,${BASE_STYLE},PrimaryColour=${COLORS.White},OutlineColour=&H40000000,BorderStyle=1,Outline=1,Shadow=1,Italic=1`,
    'cine_gold': `Fontname=Times New Roman,${BASE_STYLE},PrimaryColour=${COLORS.Gold},OutlineColour=${COLORS.Black},BorderStyle=1,Outline=1,Shadow=1`,
    'retro_mono': `Fontname=Courier New,${BASE_STYLE},PrimaryColour=${COLORS.Green},BackColour=&H80000000,BorderStyle=3,Outline=0,Shadow=0,Bold=0`
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
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(stderr)));
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
        job.files.forEach(f => {
            const match = f.originalname.match(/scene_(\d+)_(visual|audio)/);
            if (match) {
                const idx = parseInt(match[1]);
                const type = match[2];
                if (!sceneMap[idx]) sceneMap[idx] = {};
                sceneMap[idx][type] = f;
            }
        });

        const sortedScenes = Object.keys(sceneMap).sort((a,b) => a - b).map(k => sceneMap[k]);
        const clipPaths = [];
        const tempFiles = [];

        // PASSO 1: Gerar clipes individuais
        for (let i = 0; i < sortedScenes.length; i++) {
            const scene = sortedScenes[i];
            const clipPath = path.join(uploadDir, `temp_clip_${job.id}_${i}.mp4`);
            const args = [];
            const sDuration = scenesData[i]?.duration || 5;

            if (scene.visual) {
                if (scene.visual.mimetype.includes('image')) {
                    // FIXO DE SINCRONIA:
                    // 1. Geramos o vídeo com +1 segundo de duração extra no filtro zoompan.
                    // 2. Usamos -t para cortar exatamente na duração do áudio.
                    // Isso garante que o vídeo nunca seja mais curto que o áudio.
                    const extraDuration = sDuration + 1.0; 
                    const moveFilter = getMovementFilter(movement, extraDuration, targetW, targetH);
                    
                    args.push('-framerate', '30', '-loop', '1', '-i', scene.visual.path);
                    if (scene.audio) {
                        args.push('-i', scene.audio.path);
                    } else {
                        args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
                    }
                    
                    // -af apad: Preenche áudio se faltar
                    // -t sDuration: Corta no tempo EXATO
                    args.push('-vf', moveFilter, '-af', 'apad', '-t', sDuration.toString(), ...getVideoArgs(), ...getAudioArgs(), '-ac', '2', clipPath);
                } else {
                    args.push('-stream_loop', '-1', '-i', scene.visual.path);
                    if (scene.audio) {
                        args.push('-i', scene.audio.path);
                    } else {
                        args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
                    }
                    args.push('-map', '0:v', '-map', '1:a', '-vf', `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,fps=30,format=yuv420p`, '-af', 'apad', '-t', sDuration.toString(), ...getVideoArgs(), ...getAudioArgs(), clipPath);
                }
            }
            await runFFmpeg(args, job.id);
            clipPaths.push(clipPath);
            tempFiles.push(clipPath);
        }

        // PASSO 2: Legendas
        let srtPath = "";
        let forceStyle = SUBTITLE_STYLES[subtitleStyleKey] || SUBTITLE_STYLES['viral_yellow'];

        if (renderSubtitles && scenesData.length > 0) {
            let srtContent = "";
            let currentTime = 0;
            const transitionDuration = transition === 'cut' ? 0 : 1;

            scenesData.forEach((sd, idx) => {
                const dur = sd.duration || 5;
                if (!sd.narration) return;
                // Ajuste fino: Legenda termina um pouco antes da transição
                const visibleDur = dur - (idx < scenesData.length - 1 ? transitionDuration : 0);
                srtContent += `${idx + 1}\n${formatSrtTime(currentTime)} --> ${formatSrtTime(currentTime + visibleDur)}\n${sd.narration}\n\n`;
                currentTime += (dur - transitionDuration);
            });
            srtPath = path.join(uploadDir, `subs_${job.id}.srt`);
            fs.writeFileSync(srtPath, srtContent);
            tempFiles.push(srtPath);
        }

        // PASSO 3: Junção Final
        let finalArgs = [];
        const absoluteSrtPath = srtPath ? path.resolve(srtPath).split(path.sep).join('/').replace(/:/g, '\\:') : "";

        if (transition === 'cut' || clipPaths.length === 1) {
            const listPath = path.join(uploadDir, `concat_list_${job.id}.txt`);
            fs.writeFileSync(listPath, clipPaths.map(p => `file '${path.resolve(p).split(path.sep).join('/')}'`).join('\n'));
            tempFiles.push(listPath);

            if (renderSubtitles && srtPath) {
                finalArgs = [
                    '-f', 'concat', '-safe', '0', '-i', listPath, 
                    '-vf', `subtitles='${absoluteSrtPath}':force_style='${forceStyle}'`, 
                    ...getVideoArgs(), ...getAudioArgs(), outputPath
                ];
            } else {
                finalArgs = ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath];
            }
        } else {
            const inputs = []; 
            clipPaths.forEach(p => inputs.push('-i', p));
            let { filterComplex, mapArgs } = buildTransitionFilter(clipPaths.length, transition, 5, 1);
            
            if (renderSubtitles && srtPath) {
                const lastLabel = `v${clipPaths.length - 1}`;
                const rawLabel = `${lastLabel}_raw`;
                const lastIdx = filterComplex.lastIndexOf(`[${lastLabel}]`);
                if (lastIdx !== -1) {
                    filterComplex = filterComplex.substring(0, lastIdx) + `[${rawLabel}]` + filterComplex.substring(lastIdx + lastLabel.length + 2);
                    filterComplex += `;[${rawLabel}]subtitles='${absoluteSrtPath}':force_style='${forceStyle}'[${lastLabel}]`;
                }
            }
            
            finalArgs = [...inputs, '-filter_complex', filterComplex, ...mapArgs, ...getVideoArgs(), ...getAudioArgs(), outputPath];
        }

        const totalEstimated = scenesData.reduce((acc, s) => acc + (s.duration || 5), 0);
        callback(job.id, finalArgs, totalEstimated);
        setTimeout(() => tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f)), 300000); 
    } catch (e) { 
        console.error("ERRO NO EXPORT:", e); 
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
        const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
        if (timeMatch && expectedDuration > 0) {
            const cur = timeToSeconds(timeMatch[1]);
            let p = Math.round((cur / expectedDuration) * 100);
            if (jobs[jobId]) jobs[jobId].progress = 50 + (Math.min(p, 99) / 2);
        }
    });

    ffmpeg.on('close', code => {
        if (!jobs[jobId]) return;
        if (code === 0) {
            jobs[jobId].status = 'completed';
            jobs[jobId].progress = 100;
            jobs[jobId].downloadUrl = `/outputs/${path.basename(args[args.length - 1])}`;
        } else {
            console.error(`FFmpeg falhou com código ${code}`);
            jobs[jobId].status = 'failed';
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
