
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, exec } from 'child_process';
import https from 'https';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';
import * as esbuild from 'esbuild';

// Configuração de diretórios (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Garantir diretórios
[UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

console.log("\x1b[36m%s\x1b[0m", "\n🚀 [SERVER] Iniciando DarkMaker Engine (Fullstack)...");

// --- BUILD FRONTEND (ESBUILD) ---
async function buildFrontend() {
    console.log("🔨 [BUILD] Compilando assets do cliente...");
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
            define: { 
                'process.env.API_KEY': JSON.stringify(GEMINI_KEY),
                'global': 'window'
            },
            loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
        });
        console.log("✅ [BUILD] Frontend pronto.");
    } catch (e) {
        console.error("❌ [BUILD] Erro crítico:", e.message);
    }
}
await buildFrontend();

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/outputs', express.static(OUTPUT_DIR));

// --- UPLOAD CONFIG ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s/g, '_')}`)
});
const uploadAny = multer({ storage }).any();

// --- STATE ---
const jobs = {};

// --- FALLBACK DATA ---
const REAL_MUSIC_FALLBACKS = [
    { id: 'fb_m1', name: 'Cinematic Epic Trailer', artist: 'Gregor Quendel', duration: 120, previews: {'preview-hq-mp3': 'https://cdn.pixabay.com/download/audio/2022/03/09/audio_a7e2311438.mp3?filename=epic-cinematic-trailer-114407.mp3'} },
    { id: 'fb_m2', name: 'Lofi Study Beat', artist: 'FASSounds', duration: 140, previews: {'preview-hq-mp3': 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112762.mp3'} },
    { id: 'fb_m3', name: 'Corporate Uplifting', artist: 'LesFM', duration: 120, previews: {'preview-hq-mp3': 'https://cdn.pixabay.com/download/audio/2022/01/26/audio_2475143a4e.mp3?filename=upbeat-corporate-11286.mp3'} }
];

const REAL_SFX_FALLBACKS = [
    { id: 'fb_s1', name: 'Whoosh Transition', artist: 'SoundEffect', duration: 2, previews: {'preview-hq-mp3': 'https://cdn.pixabay.com/download/audio/2022/03/10/audio_c36c1e54c2.mp3?filename=whoosh-6316.mp3'} },
    { id: 'fb_s2', name: 'Cinematic Hit', artist: 'TrailerFX', duration: 4, previews: {'preview-hq-mp3': 'https://cdn.pixabay.com/download/audio/2022/03/24/audio_9593259850.mp3?filename=cinematic-boom-11749.mp3'} }
];

// --- FFMPEG HELPERS ---
function getMediaInfo(filePath) {
    return new Promise((resolve) => {
        exec(`${ffprobePath.path} -v error -show_entries stream=codec_type,duration -of csv=p=0 "${filePath}"`, (err, stdout) => {
            if (err) return resolve({ duration: 0, hasAudio: false });
            const lines = stdout.trim().split('\n');
            let duration = 0;
            let hasAudio = false;
            lines.forEach(line => {
                const parts = line.split(',');
                if (parts[0] === 'video') duration = parseFloat(parts[1]) || duration;
                if (parts[0] === 'audio') hasAudio = true;
            });
            resolve({ duration, hasAudio });
        });
    });
}

function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    if (parts.length !== 3) return 0;
    return (parseFloat(parts[0]) * 3600) + (parseFloat(parts[1]) * 60) + parseFloat(parts[2]);
}

function getAtempoFilter(speed) {
    let s = speed;
    const filters = [];
    while (s < 0.5) { filters.push('atempo=0.5'); s /= 0.5; }
    while (s > 2.0) { filters.push('atempo=2.0'); s /= 2.0; }
    filters.push(`atempo=${s.toFixed(2)}`);
    return filters.join(',');
}

function createFFmpegJob(jobId, args, expectedDuration, res) {
    if (!jobs[jobId]) jobs[jobId] = {};
    jobs[jobId].status = 'processing';
    jobs[jobId].progress = 0;
    
    // Responde ao cliente se o response object foi passado
    if (res && !res.headersSent) res.status(202).json({ jobId });

    console.log(`[FFmpeg] Job ${jobId} iniciado com args:`, args.join(' '));

    const finalArgs = ['-hide_banner', '-loglevel', 'error', '-stats', ...args];
    const ffmpeg = spawn(ffmpegPath, finalArgs);
    
    let stderr = '';

    ffmpeg.stderr.on('data', d => {
        const line = d.toString();
        stderr += line;
        const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
        if (timeMatch && expectedDuration > 0) {
            const currentTime = timeToSeconds(timeMatch[1]);
            let progress = Math.round((currentTime / expectedDuration) * 100);
            if (progress >= 100) progress = 99;
            if (progress < 0) progress = 0;
            if (jobs[jobId]) jobs[jobId].progress = progress;
        }
    });

    ffmpeg.on('close', (code) => {
        if (!jobs[jobId]) return;
        if (code === 0) {
            jobs[jobId].status = 'completed';
            jobs[jobId].progress = 100;
            jobs[jobId].downloadUrl = `/api/process/download/${jobId}`;
            console.log(`[FFmpeg] Job ${jobId} concluído.`);
        } else {
            console.error(`[FFmpeg] Job ${jobId} falhou. Code: ${code}`, stderr);
            jobs[jobId].status = 'failed';
            jobs[jobId].error = "Erro no processamento do vídeo.";
        }
    });
}

// --- LOGICA DE EXPORTAÇÃO INLINE (handleExport mockado/implementado) ---
function handleExport(job, uploadDir, callback) {
    // Implementação simplificada de exportação: Concatenação
    const outputName = `export_final_${job.id}.mp4`;
    const outputPath = path.join(uploadDir, outputName);
    
    // Encontrar arquivos de vídeo
    const videos = job.files.filter(f => f.mimetype.startsWith('video'));
    
    if (videos.length === 0) {
        // Se não houver vídeos, falha ou gera algo dummy
        jobs[job.id].status = 'failed';
        jobs[job.id].error = 'Nenhum vídeo para exportar.';
        return;
    }

    // Criar lista para concat
    const listPath = path.join(uploadDir, `list_${job.id}.txt`);
    const fileContent = videos.map(v => `file '${v.path}'`).join('\n');
    fs.writeFileSync(listPath, fileContent);

    // Args para Concat Demuxer (rápido)
    const args = [
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        '-c', 'copy',
        '-y', outputPath
    ];

    // Estima duração somando tamanhos (aproximado) ou fixa 100s se não souber
    const totalDuration = 100; // Mock duration
    callback(job.id, args, totalDuration);
}


// --- PROCESSAMENTO DE JOB (SINGLE CLIP) ---
async function processSingleClipJob(jobId) {
    const job = jobs[jobId];
    if (!job) return;

    const action = jobId.split('_')[0];
    const videoFile = job.files[0];
    if (!videoFile) { job.status = 'failed'; job.error = "Nenhum arquivo enviado."; return; }

    const { duration: originalDuration, hasAudio } = await getMediaInfo(videoFile.path);
    let params = job.params || {};
    const isAudioOnly = videoFile.mimetype.startsWith('audio/');
    let outputExt = isAudioOnly ? '.wav' : '.mp4';
    
    if (action.includes('audio') || action.includes('voice') || action.includes('silence')) outputExt = '.wav';

    const outputPath = path.join(uploadDir, `${action}-${Date.now()}${outputExt}`);
    job.outputPath = outputPath;

    let args = [];
    let expectedDuration = originalDuration;

    switch (action) {
        case 'interpolate-real':
            const speed = parseFloat(params.speed) || 0.5;
            const factor = 1 / speed;
            expectedDuration = originalDuration * factor;
            let filterComplex = `[0:v]scale='min(1280,iw)':-2,pad=ceil(iw/2)*2:ceil(ih/2)*2,setpts=${factor}*PTS,minterpolate=fps=30:mi_mode=mci:mc_mode=obmc[v]`;
            let mapping = ['-map', '[v]'];
            if (hasAudio) {
                filterComplex += `;[0:a]${getAtempoFilter(speed)}[a]`;
                mapping.push('-map', '[a]');
            }
            args = ['-i', videoFile.path, '-filter_complex', filterComplex, ...mapping, '-c:v', 'libx264', '-preset', 'ultrafast', '-y', outputPath];
            break;

        case 'upscale-real':
            args = ['-i', videoFile.path, '-vf', "scale=1920:1080:flags=lanczos", '-c:v', 'libx264', '-preset', 'ultrafast', '-y', outputPath];
            break;

        case 'reverse-real':
            args = ['-i', videoFile.path, '-vf', 'reverse', '-af', 'areverse', '-c:v', 'libx264', '-preset', 'ultrafast', '-y', outputPath];
            break;

        case 'reduce-noise-real':
            args = ['-i', videoFile.path, '-vn', '-af', 'afftdn', '-y', outputPath];
            break;

        case 'extract-audio':
            const finalAudioPath = outputPath.replace('.wav', '.mp3');
            args = ['-i', videoFile.path, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', '-y', finalAudioPath];
            job.outputPath = finalAudioPath;
            break;
        
        case 'auto-reframe-real':
            // 9:16 Crop simples
            args = ['-i', videoFile.path, '-vf', "scale=-1:1080,crop=608:1080:(iw-ow)/2:0,setsar=1", '-c:v', 'libx264', '-preset', 'ultrafast', '-y', outputPath];
            break;
            
        case 'viral-cuts':
            args = ['-i', videoFile.path, '-vf', "eq=saturation=1.3:contrast=1.1", '-c:v', 'libx264', '-preset', 'ultrafast', '-y', outputPath];
            break;

        default:
            // Generic passthrough/conversion
            args = ['-i', videoFile.path, '-c:v', 'libx264', '-preset', 'ultrafast', '-y', outputPath];
    }

    createFFmpegJob(jobId, args, expectedDuration);
}

// --- ROTAS API ---

// Proxy Pixabay
app.get('/api/proxy/pixabay', (req, res) => {
    const { q, category } = req.query;
    const isSFX = (category || '').includes('sfx') || (q || '').toLowerCase().includes('effect');
    const sourceList = isSFX ? REAL_SFX_FALLBACKS : REAL_MUSIC_FALLBACKS;
    res.json({ hits: sourceList });
});

// Proxy Freesound
app.get('/api/proxy/freesound', (req, res) => {
    // Fallback simples
    res.json({ results: REAL_MUSIC_FALLBACKS });
});

// Frame Extraction
app.post('/api/util/extract-frame', uploadAny, (req, res) => {
    const videoFile = req.files[0];
    if (!videoFile) return res.status(400).send("No video");
    const outputPath = path.join(UPLOAD_DIR, `frame_${Date.now()}.png`);
    
    // Extrai frame no timestamp 0
    const ffmpeg = spawn(ffmpegPath, ['-i', videoFile.path, '-vframes', '1', '-y', outputPath]);
    
    ffmpeg.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) res.sendFile(outputPath);
        else res.status(500).send("Frame extraction failed");
    });
});

// Start Processing Route
app.post('/api/process/start/:action', uploadAny, (req, res) => {
    const action = req.params.action;
    const jobId = `${action}_${Date.now()}`;
    jobs[jobId] = { status: 'pending', files: req.files, params: req.body, outputPath: null, startTime: Date.now() };
    processSingleClipJob(jobId);
    res.status(202).json({ jobId });
});

// Export Route
app.post('/api/export/start', uploadAny, (req, res) => {
    const jobId = `export_${Date.now()}`;
    jobs[jobId] = { id: jobId, status: 'pending', files: req.files, params: req.body, outputPath: null, startTime: Date.now() };
    res.status(202).json({ jobId });
    handleExport(jobs[jobId], UPLOAD_DIR, (id, args, totalDuration) => {
        createFFmpegJob(id, args, totalDuration);
    });
});

// Status & Download
app.get('/api/process/status/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job) return res.status(404).json({ status: 'not_found' });
    res.json(job);
});

app.get('/api/process/download/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job || job.status !== 'completed' || !job.outputPath || !fs.existsSync(job.outputPath)) {
        return res.status(404).send("Arquivo não encontrado.");
    }
    res.download(job.outputPath);
});

// Health Check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

// SPA Fallback
app.get('*', (req, res) => {
    const html = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(html)) res.sendFile(html);
    else res.send("Servidor inicializando... Atualize a página.");
});

// Cleanup Cron (10 min)
setInterval(() => {
    const now = Date.now();
    Object.keys(jobs).forEach(id => {
        if (now - jobs[id].startTime > 3600000) { // 1 hora
            if (jobs[id].outputPath && fs.existsSync(jobs[id].outputPath)) {
                try { fs.unlinkSync(jobs[id].outputPath); } catch(e){}
            }
            delete jobs[id];
        }
    });
}, 600000);

// Start
app.listen(PORT, '0.0.0.0', () => console.log(`\n🟢 SERVER ONLINE: http://0.0.0.0:${PORT}`));
