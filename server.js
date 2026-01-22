
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

// --- SUBTITLE STYLES ENGINE ---
const SUBTITLE_STYLES = {
    'viral_yellow': "Fontname=Arial,Bold=1,FontSize=22,PrimaryColour=&H00FFFF00,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=30",
    'viral_green': "Fontname=Arial,Bold=1,FontSize=22,PrimaryColour=&H0000FF00,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=30",
    'clean_white': "Fontname=Arial,Bold=1,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=1,Shadow=1,Alignment=2,MarginV=25",
    'neon_cyan': "Fontname=Arial,Bold=1,FontSize=22,PrimaryColour=&H00FFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Shadow=0,Alignment=2,MarginV=30",
    'classic_box': "Fontname=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=3,Outline=0,Shadow=0,Alignment=2,MarginV=30"
};

function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return (parseFloat(parts[0]) * 3600) + (parseFloat(parts[1]) * 60) + parseFloat(parts[2]);
}

function formatSrtTime(seconds) {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    return date.toISOString().substr(11, 8) + ',' + date.toISOString().substr(20, 3);
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

    // AJUSTE DE RESOLUÇÃO BASEADO NO ASPECT RATIO
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

        for (let i = 0; i < sortedScenes.length; i++) {
            const scene = sortedScenes[i];
            const clipPath = path.join(uploadDir, `temp_clip_${job.id}_${i}.mp4`);
            const args = [];
            
            // Duração da cena individual
            const sDuration = scenesData[i]?.duration || 5;

            if (scene.visual) {
                if (scene.visual.mimetype.includes('image')) {
                    // Passa W e H para o preset de movimentos
                    const moveFilter = getMovementFilter(movement, sDuration, targetW, targetH);
                    args.push('-framerate', '30', '-loop', '1', '-i', scene.visual.path);
                    if (scene.audio) args.push('-i', scene.audio.path, '-vf', moveFilter, '-af', 'apad', '-t', sDuration.toString(), '-fflags', '+genpts');
                    else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-vf', moveFilter, '-t', sDuration.toString());
                    args.push(...getVideoArgs(), '-video_track_timescale', '90000', ...getAudioArgs(), '-ac', '2', clipPath);
                } else {
                    args.push('-stream_loop', '-1', '-i', scene.visual.path);
                    if (scene.audio) args.push('-i', scene.audio.path);
                    else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
                    args.push('-map', '0:v', '-map', '1:a', '-vf', `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,fps=30,format=yuv420p`, '-af', 'apad', '-t', sDuration.toString(), ...getVideoArgs(), ...getAudioArgs(), clipPath);
                }
            }
            await runFFmpeg(args, job.id);
            clipPaths.push(clipPath);
            tempFiles.push(clipPath);
        }

        let srtPath = "";
        let forceStyle = SUBTITLE_STYLES[subtitleStyleKey] || SUBTITLE_STYLES['viral_yellow'];

        if (renderSubtitles && scenesData.length > 0) {
            let srtContent = "";
            let currentTime = 0;
            const transitionDuration = transition === 'cut' ? 0 : 1;

            scenesData.forEach((sd, idx) => {
                const dur = sd.duration || 5;
                const visibleDur = dur - (idx < scenesData.length - 1 ? transitionDuration : 0);
                srtContent += `${idx + 1}\n${formatSrtTime(currentTime)} --> ${formatSrtTime(currentTime + visibleDur)}\n${sd.narration || ""}\n\n`;
                currentTime += (dur - transitionDuration);
            });
            srtPath = path.join(uploadDir, `subs_${job.id}.srt`);
            fs.writeFileSync(srtPath, srtContent);
            tempFiles.push(srtPath);
        }

        let finalArgs = [];
        if (transition === 'cut' || clipPaths.length === 1) {
            const listPath = path.join(uploadDir, `concat_list_${job.id}.txt`);
            fs.writeFileSync(listPath, clipPaths.map(p => `file '${p}'`).join('\n'));
            tempFiles.push(listPath);
            if (renderSubtitles && srtPath) {
                const srtPathPosix = srtPath.split(path.sep).join('/').replace(/:/g, '\\:');
                // USANDO O ESTILO PROFISSIONAL AQUI
                finalArgs = ['-f', 'concat', '-safe', '0', '-i', listPath, '-vf', `subtitles='${srtPathPosix}':force_style='${forceStyle}'`, ...getVideoArgs(), '-c:a', 'copy', outputPath];
            } else {
                finalArgs = ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath];
            }
        } else {
            const inputs = []; clipPaths.forEach(p => inputs.push('-i', p));
            let { filterComplex, mapArgs } = buildTransitionFilter(clipPaths.length, transition, 5, 1);
            if (renderSubtitles && srtPath) {
                const srtPathPosix = srtPath.split(path.sep).join('/').replace(/:/g, '\\:');
                const lastLabel = `v${clipPaths.length - 1}`;
                const rawLabel = `${lastLabel}_raw`;
                const lastIndex = filterComplex.lastIndexOf(`[${lastLabel}]`);
                if (lastIndex !== -1) {
                    filterComplex = filterComplex.substring(0, lastIndex) + `[${rawLabel}]` + filterComplex.substring(lastIndex + lastLabel.length + 2);
                    // USANDO O ESTILO PROFISSIONAL AQUI NO FILTER COMPLEX
                    filterComplex += `;[${rawLabel}]subtitles='${srtPathPosix}':force_style='${forceStyle}'[${lastLabel}]`;
                }
            }
            finalArgs = [...inputs, '-filter_complex', filterComplex, ...mapArgs, ...getVideoArgs(), '-c:a', 'aac', '-b:a', '192k', outputPath];
        }

        const totalEstimated = scenesData.reduce((acc, s) => acc + (s.duration || 5), 0);
        callback(job.id, finalArgs, totalEstimated);
        setTimeout(() => tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f)), 300000); 
    } catch (e) { console.error(e); jobs[job.id].status = 'failed'; jobs[job.id].error = e.message; }
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
