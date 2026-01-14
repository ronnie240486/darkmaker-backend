
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import https from 'https';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

console.log("\x1b[36m%s\x1b[0m", "\n🚀 [BOOT] Iniciando Servidor Multimídia (Production Ready)...");

// --- CONFIGURAÇÃO ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Garantir diretórios
if (fs.existsSync(UPLOAD_DIR)) fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
[UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- BUILD FRONTEND (CRÍTICO: RODA SEMPRE NO START) ---
const entryPoint = path.join(__dirname, 'index.tsx');
const htmlSource = path.join(__dirname, 'index.html');
const htmlDest = path.join(PUBLIC_DIR, 'index.html');

console.log("🔨 [BUILD] Iniciando compilação do Frontend...");

try {
    // 1. Copiar HTML (Sempre)
    if (fs.existsSync(htmlSource)) {
        fs.copyFileSync(htmlSource, htmlDest);
        console.log("   📄 index.html copiado para public/");
    } else {
        console.error("   ❌ ERRO CRÍTICO: index.html não encontrado na raiz!");
    }

    // 2. Compilar React (Sempre)
    if (fs.existsSync(entryPoint)) {
        esbuild.buildSync({
            entryPoints: [entryPoint],
            bundle: true,
            outfile: path.join(PUBLIC_DIR, 'bundle.js'),
            format: 'esm',
            target: ['es2020'],
            external: ['react', 'react-dom', 'react-dom/client', '@google/genai', 'lucide-react', 'fs', 'path', 'fluent-ffmpeg'],
            loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
            define: { 'process.env.API_KEY': JSON.stringify(GEMINI_KEY), 'global': 'window' },
            minify: true, // Minificar para produção
        });
        console.log("   ✅ Bundle JS gerado com sucesso.");
    } else {
        console.error("   ❌ ERRO CRÍTICO: index.tsx não encontrado!");
    }
} catch (e) {
    console.error("   💥 FALHA NO BUILD:", e.message);
}

// --- MIDDLEWARE ---
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/outputs', express.static(OUTPUT_DIR));

// --- UPLOAD ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^a-z0-9.]/gi, '_')}`)
});
const uploadAny = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }).any();

// --- JOBS SYSTEM ---
const jobs = {};

// --- REAL AUDIO FALLBACKS ---
const REAL_MUSIC_FALLBACKS = [
    { id: 'fb_m1', name: 'Cinematic Epic Trailer', artist: 'Gregor Quendel', duration: 120, previewUrl: 'https://cdn.pixabay.com/download/audio/2022/03/09/audio_a7e2311438.mp3?filename=epic-cinematic-trailer-114407.mp3' },
    { id: 'fb_m2', name: 'Lofi Study Beat', artist: 'FASSounds', duration: 140, previewUrl: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112762.mp3' },
    { id: 'fb_m3', name: 'Corporate Uplifting', artist: 'LesFM', duration: 120, previewUrl: 'https://cdn.pixabay.com/download/audio/2022/01/26/audio_2475143a4e.mp3?filename=upbeat-corporate-11286.mp3' }
];

// --- HELPERS ---
function getDuration(filePath) {
    return new Promise((resolve) => {
        const p = spawn(ffprobeStatic.path, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]);
        let data = '';
        p.stdout.on('data', d => data += d);
        p.on('close', () => resolve(parseFloat(data) || 0));
    });
}

function createFFmpegJob(jobId, args, expectedDuration, res) {
    if (!jobs[jobId]) jobs[jobId] = {};
    jobs[jobId].status = 'processing';
    jobs[jobId].progress = 0;
    
    if (res) res.status(202).json({ jobId, status: 'processing' });

    console.log(`🎬 [JOB ${jobId}] Iniciando FFmpeg...`);

    const ffmpeg = spawn(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-stats', ...args]);
    
    let stderr = '';
    ffmpeg.stderr.on('data', d => {
        const line = d.toString();
        stderr += line;
        
        const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
        if (timeMatch && expectedDuration > 0) {
            const parts = timeMatch[1].split(':');
            const seconds = (parseFloat(parts[0]) * 3600) + (parseFloat(parts[1]) * 60) + parseFloat(parts[2]);
            let progress = Math.round((seconds / expectedDuration) * 100);
            if (progress > 99) progress = 99;
            if (jobs[jobId]) jobs[jobId].progress = progress;
        }
    });

    ffmpeg.on('close', (code) => {
        if (!jobs[jobId]) return;
        if (code === 0) {
            console.log(`✅ [JOB ${jobId}] Concluído.`);
            jobs[jobId].status = 'completed';
            jobs[jobId].progress = 100;
            const filename = path.basename(jobs[jobId].outputPath);
            jobs[jobId].downloadUrl = `/outputs/${filename}`;
        } else {
            console.error(`❌ [JOB ${jobId}] Falhou (Code ${code}):`);
            console.error(stderr.slice(-500));
            jobs[jobId].status = 'failed';
            jobs[jobId].error = "Erro no processamento do vídeo.";
        }
    });
}

// --- LOGICA DE EXPORTAÇÃO ---
async function processExportJob(jobId) {
    const job = jobs[jobId];
    if(!job) return;

    try {
        const files = job.files;
        const visuals = files.filter(f => f.fieldname === 'visuals' || f.mimetype.startsWith('video') || f.mimetype.startsWith('image'));
        const audios = files.filter(f => f.fieldname === 'audios' || f.mimetype.startsWith('audio'));
        
        const resolution = job.params.resolution || '1080p';
        const ratio = job.params.aspectRatio || '16:9';
        let w = 1920, h = 1080;
        if(resolution === '720p') { w=1280; h=720; }
        if(ratio === '9:16') { [w, h] = [h, w]; }

        const segments = [];
        let totalDuration = 0;

        for(let i=0; i<visuals.length; i++) {
            const vis = visuals[i];
            const aud = audios[i];
            
            const segName = `seg_${jobId}_${i}.mp4`;
            const segPath = path.join(UPLOAD_DIR, segName);
            
            let dur = 5; 
            if(vis.mimetype.startsWith('video')) dur = await getDuration(vis.path);
            if(aud) dur = await getDuration(aud.path) + 0.1;

            totalDuration += dur;

            const args = [];
            if(vis.mimetype.startsWith('image')) args.push('-loop', '1');
            args.push('-i', vis.path);
            
            if(aud) args.push('-i', aud.path);
            else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');

            const vFilter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,format=yuv420p`;
            const aFilter = `aresample=44100,aformat=channel_layouts=stereo`;

            args.push(
                '-filter_complex', `[0:v]${vFilter}[v];[1:a]${aFilter}[a]`,
                '-map', '[v]', '-map', '[a]',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage',
                '-c:a', 'aac', '-b:a', '128k',
                '-t', dur.toFixed(2),
                '-y', segPath
            );

            await new Promise((resolve, reject) => {
                const p = spawn(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', ...args]);
                p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Falha normalizando cena ${i}`)));
            });

            segments.push(segPath);
            jobs[jobId].progress = Math.min(20, Math.round((i/visuals.length)*20));
        }

        const listPath = path.join(UPLOAD_DIR, `list_${jobId}.txt`);
        const finalName = `FINAL_${jobId}.mp4`;
        const finalPath = path.join(OUTPUT_DIR, finalName);
        job.outputPath = finalPath;

        fs.writeFileSync(listPath, segments.map(s => `file '${s}'`).join('\n'));

        createFFmpegJob(jobId, ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-y', finalPath], 0);

    } catch(e) {
        console.error("Export Error:", e);
        job.status = 'failed';
        job.error = e.message;
    }
}

async function processSingleClipJob(jobId) {
    const job = jobs[jobId];
    if (!job) return;

    const action = jobId.split('_')[0];
    const videoFile = job.files[0];
    if (!videoFile) { job.status = 'failed'; job.error = "Nenhum arquivo."; return; }

    const originalDuration = await getDuration(videoFile.path);
    const outputPath = path.join(OUTPUT_DIR, `${action}_${Date.now()}.mp4`);
    job.outputPath = outputPath;

    let args = [];
    let expectedDuration = originalDuration;

    switch (action) {
        case 'upscale':
            args = ['-i', videoFile.path, '-vf', "scale=3840:2160:flags=lanczos", '-c:v', 'libx264', '-preset', 'ultrafast', '-y', outputPath];
            break;
        case 'compress':
            args = ['-i', videoFile.path, '-c:v', 'libx264', '-crf', '28', '-preset', 'faster', '-y', outputPath];
            break;
        case 'cut':
            args = ['-i', videoFile.path, '-ss', '0', '-t', '10', '-c', 'copy', '-y', outputPath];
            expectedDuration = 10;
            break;
        case 'convert':
            args = ['-i', videoFile.path, '-c:v', 'libx264', '-c:a', 'aac', '-y', outputPath];
            break;
        case 'extract-audio':
            const mp3Path = outputPath.replace('.mp4', '.mp3');
            job.outputPath = mp3Path;
            args = ['-i', videoFile.path, '-vn', '-acodec', 'libmp3lame', '-y', mp3Path];
            break;
        default:
            args = ['-i', videoFile.path, '-c', 'copy', '-y', outputPath];
    }

    createFFmpegJob(jobId, args, expectedDuration);
}

// --- ENDPOINTS ---

app.get('/api/health', (req, res) => res.json({ status: 'online' }));

app.post('/api/export/start', uploadAny, (req, res) => {
    const jobId = `export_${Date.now()}`;
    jobs[jobId] = { id: jobId, status: 'pending', files: req.files, params: req.body, outputPath: null, startTime: Date.now() };
    res.status(202).json({ jobId, status: 'pending' });
    processExportJob(jobId);
});

app.post('/api/render', uploadAny, (req, res) => {
    const jobId = `render_${Date.now()}`;
    jobs[jobId] = { id: jobId, status: 'pending', files: req.files, params: req.body, startTime: Date.now() };
    res.status(202).json({ jobId, status: 'pending', legacy: true }); 
    processExportJob(jobId);
});

app.post('/api/process/start/:action', uploadAny, (req, res) => {
    const action = req.params.action;
    const jobId = `${action}_${Date.now()}`;
    jobs[jobId] = { status: 'pending', files: req.files, params: req.body, startTime: Date.now() };
    res.status(202).json({ jobId });
    processSingleClipJob(jobId);
});

app.get('/api/process/status/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job) return res.status(404).json({ status: 'not_found' });
    res.json({
        id: req.params.jobId,
        status: job.status,
        progress: job.progress || 0,
        downloadUrl: job.downloadUrl,
        error: job.error
    });
});

app.get('/api/process/download/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job || !job.outputPath || !fs.existsSync(job.outputPath)) {
        return res.status(404).send("Arquivo não encontrado.");
    }
    res.download(job.outputPath);
});

app.get('/api/proxy/pixabay', (req, res) => {
    const { q } = req.query;
    const results = REAL_MUSIC_FALLBACKS.filter(item => 
        !q || item.name.toLowerCase().includes(String(q).toLowerCase())
    );
    res.json({ hits: results });
});

// SPA FALLBACK (ROBUSTO)
app.get('*', (req, res) => {
    const idx = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(idx)) {
        res.sendFile(idx);
    } else {
        // Tenta copiar novamente se não existir
        if(fs.existsSync('index.html')) {
            try {
                fs.copyFileSync('index.html', idx);
                return res.sendFile(idx);
            } catch(e) {
                console.error("Erro ao recuperar index.html", e);
            }
        }
        
        // Página de Loading Auto-Refresh
        res.status(503).send(`
            <!DOCTYPE html>
            <html style="background:#050505;color:white;font-family:sans-serif;height:100%;">
            <head><meta http-equiv="refresh" content="3"></head>
            <body style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;">
                <h1 style="color:#3b82f6;">Inicializando Sistema...</h1>
                <p>O servidor está compilando o aplicativo. A página recarregará automaticamente.</p>
                <div style="width:200px;height:4px;background:#333;margin-top:20px;border-radius:2px;overflow:hidden;">
                    <div style="width:50%;height:100%;background:#3b82f6;animation:load 1s infinite;"></div>
                </div>
                <style>@keyframes load{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}</style>
            </body>
            </html>
        `);
    }
});

setInterval(() => {
    const now = Date.now();
    Object.keys(jobs).forEach(id => {
        if (now - jobs[id].startTime > 3600000) delete jobs[id];
    });
}, 600000);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🟢 SERVER READY: http://localhost:${PORT}`);
});
