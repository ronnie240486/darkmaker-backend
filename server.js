
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

console.log("\x1b[36m%s\x1b[0m", "\n🚀 [BOOT] Iniciando Servidor Multimídia (Baseado em spawn/jobs)...");

// --- CONFIGURAÇÃO ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (fs.existsSync(UPLOAD_DIR)) fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
[UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- BUILD FRONTEND ---
const entryPoint = path.join(__dirname, 'index.tsx');
if (fs.existsSync(entryPoint) && !fs.existsSync(path.join(PUBLIC_DIR, 'bundle.js'))) {
    console.log("🔨 [BUILD] Compilando Frontend...");
    esbuild.buildSync({
        entryPoints: [entryPoint],
        bundle: true,
        outfile: path.join(PUBLIC_DIR, 'bundle.js'),
        format: 'esm',
        target: ['es2020'],
        external: ['react', 'react-dom', 'react-dom/client', '@google/genai', 'lucide-react', 'fs', 'path', 'fluent-ffmpeg'],
        loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
        define: { 'process.env.API_KEY': JSON.stringify(GEMINI_KEY), 'global': 'window' },
    });
    if (fs.existsSync('index.html')) fs.copyFileSync('index.html', path.join(PUBLIC_DIR, 'index.html'));
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
    
    // Se response object foi passado, responde imediatamente com o ID
    if (res) res.status(202).json({ jobId, status: 'processing' });

    console.log(`🎬 [JOB ${jobId}] Iniciando FFmpeg...`);
    // console.log(`   Cmd: ffmpeg ${args.join(' ')}`);

    const ffmpeg = spawn(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-stats', ...args]);
    
    let stderr = '';
    ffmpeg.stderr.on('data', d => {
        const line = d.toString();
        stderr += line;
        
        // Parse progress time
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
            // O outputPath é definido antes de chamar essa função
            const filename = path.basename(jobs[jobId].outputPath);
            jobs[jobId].downloadUrl = `/outputs/${filename}`; // Direct static link
        } else {
            console.error(`❌ [JOB ${jobId}] Falhou (Code ${code}):`);
            console.error(stderr.slice(-500));
            jobs[jobId].status = 'failed';
            jobs[jobId].error = "Erro no processamento do vídeo (FFmpeg). Verifique os formatos.";
        }
    });
}

// --- LOGICA DE EXPORTAÇÃO (Handle Export) ---
// Normaliza e concatena múltiplos arquivos
async function processExportJob(jobId) {
    const job = jobs[jobId];
    if(!job) return;

    try {
        const files = job.files; // Array de arquivos do multer
        // Separar visuais e audios baseados nos fieldnames ou mimetype
        const visuals = files.filter(f => f.fieldname === 'visuals' || f.mimetype.startsWith('video') || f.mimetype.startsWith('image'));
        const audios = files.filter(f => f.fieldname === 'audios' || f.mimetype.startsWith('audio'));
        
        const resolution = job.params.resolution || '1080p';
        const ratio = job.params.aspectRatio || '16:9';
        let w = 1920, h = 1080;
        if(resolution === '720p') { w=1280; h=720; }
        if(ratio === '9:16') { [w, h] = [h, w]; }

        const segments = [];
        let totalDuration = 0;

        // Fase 1: Normalização
        for(let i=0; i<visuals.length; i++) {
            const vis = visuals[i];
            const aud = audios[i]; // Pode ser undefined
            
            const segName = `seg_${jobId}_${i}.mp4`;
            const segPath = path.join(UPLOAD_DIR, segName);
            
            // Calcula duração
            let dur = 5; // Default image
            if(vis.mimetype.startsWith('video')) dur = await getDuration(vis.path);
            if(aud) dur = await getDuration(aud.path) + 0.1; // Audio manda na duração se existir

            totalDuration += dur;

            // Constroi comando de normalização para este segmento
            const args = [];
            
            // Inputs
            if(vis.mimetype.startsWith('image')) args.push('-loop', '1');
            args.push('-i', vis.path);
            
            if(aud) args.push('-i', aud.path);
            else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');

            // Filters
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

            // Executa sincrono (await spawn)
            await new Promise((resolve, reject) => {
                const p = spawn(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', ...args]);
                p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Falha normalizando cena ${i}`)));
            });

            segments.push(segPath);
            // Atualiza progresso parcial (fase de preparação = 0-20%)
            jobs[jobId].progress = Math.min(20, Math.round((i/visuals.length)*20));
        }

        // Fase 2: Concatenação
        const listPath = path.join(UPLOAD_DIR, `list_${jobId}.txt`);
        const finalName = `FINAL_${jobId}.mp4`;
        const finalPath = path.join(OUTPUT_DIR, finalName);
        job.outputPath = finalPath;

        fs.writeFileSync(listPath, segments.map(s => `file '${s}'`).join('\n'));

        // Inicia o job final de concatenação (Copy mode = rápido)
        // Como copy é instantaneo, vamos re-encodar levemente para garantir integridade ou apenas copy se confiarmos na normalização
        // Vamos usar concat demuxer com copy
        createFFmpegJob(jobId, ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-y', finalPath], 0);

    } catch(e) {
        console.error("Export Error:", e);
        job.status = 'failed';
        job.error = e.message;
    }
}

// --- ROTAS DE PROCESSO UNICO ---
async function processSingleClipJob(jobId) {
    const job = jobs[jobId];
    if (!job) return;

    const action = jobId.split('_')[0]; // ex: 'upscale' de 'upscale_123'
    const videoFile = job.files[0];
    if (!videoFile) { job.status = 'failed'; job.error = "Nenhum arquivo."; return; }

    const originalDuration = await getDuration(videoFile.path);
    const outputPath = path.join(OUTPUT_DIR, `${action}_${Date.now()}.mp4`); // Salva direto em output
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
            args = ['-i', videoFile.path, '-ss', '0', '-t', '10', '-c', 'copy', '-y', outputPath]; // Exemplo fixo, idealmente params
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

// ROTA DE EXPORTAÇÃO (MAIN)
app.post('/api/export/start', uploadAny, (req, res) => {
    // console.log("Recebido request exportação:", req.files.length, "arquivos");
    const jobId = `export_${Date.now()}`;
    jobs[jobId] = { 
        id: jobId,
        status: 'pending', 
        files: req.files, 
        params: req.body, 
        outputPath: null, 
        startTime: Date.now() 
    };
    
    // Responde e inicia
    res.status(202).json({ jobId, status: 'pending' });
    processExportJob(jobId);
});

// ROTA DE RENDERIZAÇÃO LEGADA (Compatibilidade com IA Turbo antiga se chamar /render)
// Redireciona internamente para lógica de export
app.post('/api/render', uploadAny, (req, res) => {
    const jobId = `render_${Date.now()}`;
    jobs[jobId] = { id: jobId, status: 'pending', files: req.files, params: req.body, startTime: Date.now() };
    res.status(202).json({ jobId, status: 'pending', legacy: true }); 
    processExportJob(jobId);
});

// ROTAS DE FERRAMENTAS SIMPLES
app.post('/api/process/start/:action', uploadAny, (req, res) => {
    const action = req.params.action;
    const jobId = `${action}_${Date.now()}`;
    jobs[jobId] = { status: 'pending', files: req.files, params: req.body, startTime: Date.now() };
    res.status(202).json({ jobId });
    processSingleClipJob(jobId);
});

// POLLING STATUS
app.get('/api/process/status/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job) return res.status(404).json({ status: 'not_found' });
    
    // Se for rota legada /render esperando URL direta no JSON, podemos tentar adaptar, 
    // mas o ideal é o frontend suportar polling.
    res.json({
        id: req.params.jobId,
        status: job.status,
        progress: job.progress || 0,
        downloadUrl: job.downloadUrl,
        error: job.error
    });
});

// DOWNLOAD
app.get('/api/process/download/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job || !job.outputPath || !fs.existsSync(job.outputPath)) {
        return res.status(404).send("Arquivo não encontrado.");
    }
    res.download(job.outputPath);
});

// PROXY PIXABAY
app.get('/api/proxy/pixabay', (req, res) => {
    const { q } = req.query;
    const results = REAL_MUSIC_FALLBACKS.filter(item => 
        !q || item.name.toLowerCase().includes(String(q).toLowerCase())
    );
    res.json({ hits: results });
});

// SPA FALLBACK
app.get('*', (req, res) => {
    const idx = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(idx)) res.sendFile(idx);
    else res.send("<h1>Server Loading...</h1>");
});

// CLEANUP
setInterval(() => {
    const now = Date.now();
    Object.keys(jobs).forEach(id => {
        if (now - jobs[id].startTime > 3600000) { // 1 hora
            // Opcional: deletar arquivo fisico
            delete jobs[id];
        }
    });
}, 600000);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🟢 SERVER READY: http://localhost:${PORT}`);
});
