
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import * as esbuild from 'esbuild';

import { getMovementFilter } from './presets/movements.js';
import { buildTransitionFilter } from './presets/transitions.js';

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

function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return (parseFloat(parts[0]) * 3600) + (parseFloat(parts[1]) * 60) + parseFloat(parts[2]);
}

function runFFmpeg(args) {
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
    const aspectRatio = job.params?.aspectRatio || '16:9';

    let targetW = 1280; let targetH = 720;
    if (aspectRatio === '9:16') { targetW = 720; targetH = 1280; }

    let scenesData = [];
    try { if (job.params?.scenesData) scenesData = JSON.parse(job.params.scenesData); } catch(e) {}

    try {
        const sceneMap = {};
        job.files.forEach(f => {
            const match = f.originalname.match(/scene_(\d+)/);
            if (match) {
                const idx = parseInt(match[1]);
                const type = f.originalname.includes('visual') ? 'visual' : 'audio';
                if (!sceneMap[idx]) sceneMap[idx] = {};
                sceneMap[idx][type] = f;
            }
        });

        const sortedIndices = Object.keys(sceneMap).sort((a,b) => a - b);
        const clipPaths = [];
        const tempFiles = [];

        for (let i = 0; i < sortedIndices.length; i++) {
            const idx = sortedIndices[i];
            const scene = sceneMap[idx];
            const clipPath = path.join(uploadDir, `temp_clip_${job.id}_${i}.mp4`);
            const sDuration = scenesData[i]?.duration || 5;

            const args = [];
            if (scene.visual) {
                if (scene.visual.mimetype.includes('image')) {
                    const moveFilter = getMovementFilter(movement, sDuration, targetW, targetH);
                    args.push('-framerate', '30', '-loop', '1', '-i', scene.visual.path);
                    if (scene.audio) args.push('-i', scene.audio.path, '-vf', moveFilter, '-af', 'apad', '-t', sDuration.toString());
                    else args.push('-f', 'lavfi', '-i', 'anullsrc=cl=stereo:sr=44100', '-vf', moveFilter, '-t', sDuration.toString());
                    args.push(...getVideoArgs(), clipPath);
                } else {
                    args.push('-stream_loop', '-1', '-i', scene.visual.path);
                    if (scene.audio) args.push('-i', scene.audio.path);
                    else args.push('-f', 'lavfi', '-i', 'anullsrc=cl=stereo:sr=44100');
                    args.push('-map', '0:v', '-map', '1:a', '-vf', `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,fps=30`, '-af', 'apad', '-t', sDuration.toString(), ...getVideoArgs(), clipPath);
                }
            }
            await runFFmpeg(args);
            clipPaths.push(clipPath);
            tempFiles.push(clipPath);
        }

        let finalArgs = [];
        if (transition === 'cut' || clipPaths.length === 1) {
            const listPath = path.join(uploadDir, `list_${job.id}.txt`);
            fs.writeFileSync(listPath, clipPaths.map(p => `file '${p}'`).join('\n'));
            finalArgs = ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath];
            tempFiles.push(listPath);
        } else {
            const inputs = []; clipPaths.forEach(p => inputs.push('-i', p));
            // FIX: Passando scenesData para calcular offsets corretos das transições
            let { filterComplex, mapArgs } = buildTransitionFilter(clipPaths.length, transition, scenesData, 1);
            finalArgs = [...inputs, '-filter_complex', filterComplex, ...mapArgs, ...getVideoArgs(), outputPath];
        }

        const totalEstimated = scenesData.reduce((acc, s) => acc + (s.duration || 5), 0);
        callback(job.id, finalArgs, totalEstimated);
        setTimeout(() => tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f)), 600000); 
    } catch (e) { console.error(e); jobs[job.id].status = 'failed'; }
}

function createFFmpegJob(jobId, args, expectedDuration) {
    jobs[jobId].status = 'processing';
    const ffmpeg = spawn(ffmpegPath, ['-hide_banner', '-stats', '-y', ...args]);
    ffmpeg.stderr.on('data', d => {
        const line = d.toString();
        const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
        if (timeMatch && expectedDuration > 0) {
            const cur = timeToSeconds(timeMatch[1]);
            jobs[jobId].progress = Math.min(Math.round((cur / expectedDuration) * 100), 99);
        }
    });
    ffmpeg.on('close', code => {
        if (!jobs[jobId]) return;
        if (code === 0) {
            jobs[jobId].status = 'completed';
            jobs[jobId].progress = 100;
            jobs[jobId].downloadUrl = `/outputs/${path.basename(args[args.length - 1])}`;
        } else { jobs[jobId].status = 'failed'; }
    });
}

app.post('/api/export/start', uploadAny, (req, res) => {
    const jobId = `export_${Date.now()}`;
    jobs[jobId] = { id: jobId, status: 'processing', progress: 5, files: req.files, params: req.body };
    res.status(202).json({ jobId });
    handleExport(jobs[jobId], UPLOAD_DIR, (id, args, dur) => createFFmpegJob(id, args, dur));
});

app.get('/api/process/status/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job) return res.status(404).json({ status: 'not_found' });
    res.json(job);
});

app.listen(PORT, '0.0.0.0', () => console.log(`Backend 9:16 Sync Online na porta ${PORT}`));
