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
// Middleware de Log Global (Para debug "não tem nenhum log")
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});
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

// --- FFMPEG HELPERS ---
function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    if (parts.length !== 3) return 0;
    return (parseFloat(parts[0]) * 3600) + (parseFloat(parts[1]) * 60) + parseFloat(parts[2]);
}

function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        console.log("Running FFmpeg:", args.join(' '));
        const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
        let stderr = '';
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg error (code ${code}): ${stderr}`));
        });
    });
}

// --- CORE JOB PROCESSING ---

// 1. Processamento Genérico (Ferramentas Individuais)
async function processGenericJob(jobId, action, files, params) {
    if (!files || files.length === 0) {
        jobs[jobId].status = 'failed';
        jobs[jobId].error = "Sem arquivos de entrada.";
        return;
    }

    try {
        jobs[jobId].status = 'processing';
        jobs[jobId].progress = 10;

        const inputPath = files[0].path;
        let outputExt = 'mp4';
        if (files[0].mimetype.includes('audio')) outputExt = 'mp3';
        
        // Ajuste de extensão baseado na ação
        if (action === 'extract-audio') outputExt = 'mp3';
        if (action === 'convert') outputExt = params.format || 'mp4';

        const outputPath = path.join(UPLOAD_DIR, `${action}_${jobId}.${outputExt}`);
        const args = [];

        switch (action) {
            case 'remove-audio':
                // Remove áudio do vídeo
                args.push('-i', inputPath, '-c:v', 'copy', '-an', outputPath);
                break;

            case 'extract-audio':
                // Extrai áudio para MP3
                args.push('-i', inputPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', outputPath);
                break;

            case 'compress':
                // Comprime vídeo (CRF 28)
                if (outputExt === 'mp3') {
                    args.push('-i', inputPath, '-map', '0:a', '-b:a', '64k', outputPath);
                } else {
                    args.push('-i', inputPath, '-vcodec', 'libx264', '-crf', '28', '-preset', 'fast', outputPath);
                }
                break;

            case 'join':
                // Unir arquivos (Vídeo ou Áudio)
                if (files.length < 2) throw new Error("Necessário pelo menos 2 arquivos para unir.");
                const listPath = path.join(UPLOAD_DIR, `join_list_${jobId}.txt`);
                const listContent = files.map(f => `file '${f.path}'`).join('\n');
                fs.writeFileSync(listPath, listContent);
                
                // Concat demuxer
                args.push('-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath);
                break;

            case 'cut':
                // Cortar (Mockado fixo para demonstração se não vier params, idealmente params.start/duration)
                // Se não vier params, corta primeiros 10s
                const start = params.start || '00:00:00';
                const duration = params.duration || '10';
                args.push('-ss', start, '-i', inputPath, '-t', duration, '-c', 'copy', outputPath);
                break;

            case 'clean-video':
                // Denoise visual
                args.push('-i', inputPath, '-vf', 'hqdn3d=1.5:1.5:6:6', '-c:a', 'copy', outputPath);
                break;
            
            case 'clean-audio':
                // Redução de ruído áudio
                args.push('-i', inputPath, '-af', 'afftdn=nf=-25', outputPath);
                break;

            case 'stems':
                // Separação de Stems (Simulação Karaoke via inversão de fase stereo)
                // Nota: Separação real exige Python/Spleeter. Aqui usamos um truque FFmpeg.
                args.push('-i', inputPath, '-af', 'pan="stereo|c0=c0|c1=-1*c1"', outputPath);
                break;

            case 'convert':
                args.push('-i', inputPath, outputPath);
                break;

            default:
                // Fallback: Copy
                args.push('-i', inputPath, outputPath);
        }

        console.log(`[Job ${jobId}] Executando ação: ${action}`);
        
        // Executar FFmpeg e monitorar
        // Para simplificar ferramentas rápidas, usamos await runFFmpeg sem progress bar detalhada aqui,
        // mas marcamos progresso simulado.
        jobs[jobId].progress = 50;
        await runFFmpeg(args);
        
        jobs[jobId].progress = 100;
        jobs[jobId].status = 'completed';
        jobs[jobId].outputPath = outputPath; // Salva path para download
        jobs[jobId].downloadUrl = `/api/process/download/${jobId}`;

    } catch (e) {
        console.error(`[Job ${jobId}] Falha:`, e);
        jobs[jobId].status = 'failed';
        jobs[jobId].error = e.message;
    }
}

// 2. Renderização de Roteiro (Workflow Mágico / IA Turbo)
// Une Imagem + Áudio em clipes e depois une tudo
async function handleExport(job, uploadDir, callback) {
    const outputName = `render_${job.id}.mp4`;
    const outputPath = path.join(uploadDir, outputName);
    
    try {
        console.log(`[Job ${job.id}] Iniciando renderização complexa...`);

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
        if (sortedScenes.length === 0) throw new Error("Nenhuma cena identificada.");

        const clipPaths = [];
        const tempFiles = [];

        // Renderizar cada cena
        for (let i = 0; i < sortedScenes.length; i++) {
            const scene = sortedScenes[i];
            const clipPath = path.join(uploadDir, `temp_clip_${job.id}_${i}.mp4`);
            const args = [];
            
            // Padronização 720p
            const commonOutputArgs = [
                '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-ar', '44100', '-ac', '2',
                '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1',
                '-y', clipPath
            ];
            
            if (scene.visual && scene.audio) {
                if (scene.visual.mimetype.includes('image')) {
                    // Imagem + Áudio
                    args.push(
                        '-loop', '1', '-i', scene.visual.path,
                        '-i', scene.audio.path,
                        '-tune', 'stillimage', '-shortest',
                        ...commonOutputArgs
                    );
                } else {
                    // Video + Áudio (Substitui áudio original)
                    args.push(
                        '-i', scene.visual.path,
                        '-i', scene.audio.path,
                        '-map', '0:v', '-map', '1:a', '-shortest',
                        ...commonOutputArgs
                    );
                }
            } else if (scene.visual && !scene.audio) {
                // Só Imagem
                if (scene.visual.mimetype.includes('image')) {
                    args.push(
                        '-loop', '1', '-i', scene.visual.path,
                        '-t', '5',
                        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
                        ...commonOutputArgs
                    );
                } else {
                    // Só Vídeo
                    args.push('-i', scene.visual.path, ...commonOutputArgs);
                }
            } else {
                continue; 
            }

            console.log(`[Job ${job.id}] Renderizando clipe ${i}...`);
            await runFFmpeg(args);
            clipPaths.push(clipPath);
            tempFiles.push(clipPath);
        }

        // Concatenar
        if (clipPaths.length === 0) throw new Error("Falha na geração de clipes.");

        const listPath = path.join(uploadDir, `concat_list_${job.id}.txt`);
        const fileContent = clipPaths.map(p => `file '${p}'`).join('\n');
        fs.writeFileSync(listPath, fileContent);
        tempFiles.push(listPath);

        const concatArgs = [
            '-f', 'concat', '-safe', '0', '-i', listPath,
            '-c', 'copy', '-y', outputPath
        ];

        const totalDuration = clipPaths.length * 10; 
        
        callback(job.id, concatArgs, totalDuration);

        setTimeout(() => {
            tempFiles.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });
        }, 60000);

    } catch (e) {
        console.error(`[Job ${job.id}] Erro Fatal:`, e);
        jobs[job.id].status = 'failed';
        jobs[job.id].error = e.message;
    }
}

// --- FFMPEG JOB MONITOR ---
function createFFmpegJob(jobId, args, expectedDuration, res) {
    if (!jobs[jobId]) jobs[jobId] = {};
    
    if(jobs[jobId].status !== 'processing') {
        jobs[jobId].status = 'processing';
        jobs[jobId].progress = 0;
    }
    
    if (res && !res.headersSent) res.status(202).json({ jobId });

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
            if (progress > 100) progress = 99;
            if (jobs[jobId]) jobs[jobId].progress = progress;
        }
    });

    ffmpeg.on('close', (code) => {
        if (!jobs[jobId]) return;
        if (code === 0) {
            jobs[jobId].status = 'completed';
            jobs[jobId].progress = 100;
            jobs[jobId].downloadUrl = `/api/process/download/${jobId}`;
            console.log(`[Job ${jobId}] Processo Finalizado Sucesso.`);
        } else {
            console.error(`[Job ${jobId}] FFmpeg falhou code ${code}`, stderr);
            jobs[jobId].status = 'failed';
            jobs[jobId].error = "Erro na renderização final.";
        }
    });
}

// --- ROTAS API ---

// Rota Genérica para Ferramentas (Audio/Video)
app.post('/api/process/start/:action', uploadAny, (req, res) => {
    const action = req.params.action;
    const jobId = `${action}_${Date.now()}`;
    
    console.log(`\n🔵 [API] Novo Job Genérico: ${action} (ID: ${jobId})`);
    
    jobs[jobId] = { 
        id: jobId,
        status: 'pending', 
        files: req.files, 
        params: req.body, 
        outputPath: null, 
        startTime: Date.now() 
    };
    
    // Responde Imediatamente com JobID
    res.status(202).json({ jobId });

    // Inicia processamento assíncrono
    processGenericJob(jobId, action, req.files, req.body);
});

// Rota Específica para Exportação Complexa (Magic Workflow)
app.post('/api/export/start', uploadAny, (req, res) => {
    const jobId = `export_${Date.now()}`;
    
    console.log(`\n🟣 [API] Novo Job Exportação Complexa (ID: ${jobId})`);
    console.log(`    Arquivos recebidos: ${req.files ? req.files.length : 0}`);

    jobs[jobId] = { 
        id: jobId, 
        status: 'processing',
        progress: 5,
        files: req.files, 
        params: req.body, 
        outputPath: null, 
        startTime: Date.now() 
    };
    
    res.status(202).json({ jobId });

    handleExport(jobs[jobId], UPLOAD_DIR, (id, args, totalDuration) => {
        createFFmpegJob(id, args, totalDuration);
    });
});

app.get('/api/process/status/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job) return res.status(404).json({ status: 'not_found' });
    res.json(job);
});

app.get('/api/process/download/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job || job.status !== 'completed') return res.status(404).send("Arquivo não pronto ou não encontrado.");
    
    // 1. Tenta usar o outputPath salvo explicitamente (ferramentas genéricas)
    if (job.outputPath && fs.existsSync(job.outputPath)) {
        return res.download(job.outputPath);
    }

    // 2. Tenta padrão de render export
    const renderPath = path.join(UPLOAD_DIR, `render_${job.id}.mp4`);
    if(fs.existsSync(renderPath)) {
        return res.download(renderPath);
    }

    res.status(404).send("Arquivo físico não encontrado.");
});

// Utilities
app.get('/api/proxy/pixabay', (req, res) => res.json({ hits: [] }));
app.get('/api/health', (req, res) => res.send('OK'));

// Cleanup
setInterval(() => {
    const now = Date.now();
    Object.keys(jobs).forEach(id => {
        if (now - jobs[id].startTime > 3600000) {
             if (jobs[id].outputPath && fs.existsSync(jobs[id].outputPath)) fs.unlinkSync(jobs[id].outputPath);
             delete jobs[id];
        }
    });
}, 600000);

app.listen(PORT, '0.0.0.0', () => console.log(`\n🟢 SERVER ONLINE: http://0.0.0.0:${PORT}`));
