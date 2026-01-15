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

// Wrapper para executar comando FFmpeg Promise-based
function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
        let stderr = '';
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg error (code ${code}): ${stderr}`));
        });
    });
}

// --- LOGICA DE EXPORTAÇÃO E RENDERIZAÇÃO REAL (SERVER SIDE) ---
async function handleExport(job, uploadDir, callback) {
    const outputName = `render_${job.id}.mp4`;
    const outputPath = path.join(uploadDir, outputName);
    
    try {
        console.log(`[Job ${job.id}] Iniciando renderização no servidor...`);

        // 1. Organizar arquivos por cena (scene_0_visual, scene_0_audio, etc)
        const sceneMap = {};
        job.files.forEach(f => {
            const match = f.originalname.match(/scene_(\d+)_(visual|audio)/);
            if (match) {
                const idx = parseInt(match[1]);
                const type = match[2];
                if (!sceneMap[idx]) sceneMap[idx] = {};
                sceneMap[idx][type] = f.path;
            }
        });

        const sortedScenes = Object.keys(sceneMap).sort((a,b) => a - b).map(k => sceneMap[k]);
        if (sortedScenes.length === 0) throw new Error("Nenhuma cena identificada nos arquivos.");

        const clipPaths = [];
        const tempFiles = []; // Para limpar depois

        // 2. Processar cada cena: Imagem + Áudio -> Vídeo MP4
        for (let i = 0; i < sortedScenes.length; i++) {
            const scene = sortedScenes[i];
            const clipPath = path.join(uploadDir, `temp_clip_${job.id}_${i}.mp4`);
            
            // Argumentos para converter imagem estática + áudio em vídeo
            // -loop 1 (loop imagem)
            // -shortest (terminar quando o áudio acabar)
            // -tune stillimage (otimização)
            // pad para garantir 16:9 ou paridade de pixels
            const args = [];
            
            if (scene.visual && scene.audio) {
                // Caso padrão: Imagem + Áudio
                args.push(
                    '-loop', '1', '-i', scene.visual,
                    '-i', scene.audio,
                    '-c:v', 'libx264', '-tune', 'stillimage', '-c:a', 'aac', '-b:a', '192k',
                    '-pix_fmt', 'yuv420p', '-shortest',
                    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1',
                    clipPath
                );
            } else if (scene.visual && !scene.audio) {
                // Só imagem (5 segundos)
                args.push(
                    '-loop', '1', '-i', scene.visual,
                    '-c:v', 'libx264', '-t', '5', '-pix_fmt', 'yuv420p',
                    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1',
                    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-c:a', 'aac', '-shortest',
                    clipPath
                );
            } else {
                continue; // Pula se estiver incompleto
            }

            console.log(`[Job ${job.id}] Renderizando clipe ${i}...`);
            await runFFmpeg(args);
            clipPaths.push(clipPath);
            tempFiles.push(clipPath);
        }

        // 3. Concatenar clipes
        if (clipPaths.length === 0) throw new Error("Falha ao gerar clipes individuais.");

        const listPath = path.join(uploadDir, `concat_list_${job.id}.txt`);
        const fileContent = clipPaths.map(p => `file '${p}'`).join('\n');
        fs.writeFileSync(listPath, fileContent);
        tempFiles.push(listPath);

        console.log(`[Job ${job.id}] Unindo clipes...`);
        const concatArgs = [
            '-f', 'concat', '-safe', '0', '-i', listPath,
            '-c', 'copy', outputPath
        ];

        // Chama o callback que inicia o job "oficial" de concatenação (que o cliente monitora)
        // Estimamos duração total como soma simples (mock 10s por cena se não souber)
        const totalDuration = clipPaths.length * 10; 
        
        callback(job.id, concatArgs, totalDuration);

        // Limpeza assíncrona (após um tempo para garantir que ffmpeg pegou os arquivos)
        setTimeout(() => {
            tempFiles.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });
        }, 60000);

    } catch (e) {
        console.error(`[Job ${job.id}] Erro Fatal:`, e);
        jobs[job.id].status = 'failed';
        jobs[job.id].error = e.message;
    }
}

// --- FFMPEG JOB HANDLER ---
function createFFmpegJob(jobId, args, expectedDuration, res) {
    if (!jobs[jobId]) jobs[jobId] = {};
    
    // Se o status já for processing (setado pelo handleExport), mantemos
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
        // Tenta extrair tempo para barra de progresso
        const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
        if (timeMatch && expectedDuration > 0) {
            const currentTime = timeToSeconds(timeMatch[1]);
            let progress = Math.round((currentTime / expectedDuration) * 100);
            if (progress > 100) progress = 99; // Segura em 99 até fechar
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

app.post('/api/process/start/:action', uploadAny, (req, res) => {
    const action = req.params.action;
    const jobId = `${action}_${Date.now()}`;
    jobs[jobId] = { status: 'pending', files: req.files, params: req.body, outputPath: null, startTime: Date.now() };
    
    // Lógica para processamento simples (clip único)
    // Para simplificar, usamos a função de job genérica se não for exportação complexa
    if (action !== 'export') {
        // ... (lógica existente de processSingleClipJob pode ser chamada aqui ou inline)
        // Simulando resposta rápida para manter compatibilidade com server anterior
        res.status(202).json({ jobId });
        // Aqui chamariamos processSingleClipJob(jobId) (ver código anterior)
    }
});

// Export Route (Complexa - Renderização de Roteiro)
app.post('/api/export/start', uploadAny, (req, res) => {
    const jobId = `export_${Date.now()}`;
    jobs[jobId] = { 
        id: jobId, 
        status: 'processing', // Já marcamos como processando pois handleExport faz trabalho pesado
        progress: 5,
        files: req.files, 
        params: req.body, 
        outputPath: null, 
        startTime: Date.now() 
    };
    
    // Responde Imediatamente com o ID
    res.status(202).json({ jobId });

    // Inicia o processo pesado em background
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
    if (!job || job.status !== 'completed' || !fs.existsSync(path.join(UPLOAD_DIR, `render_${job.id}.mp4`))) {
        // Tenta achar pelo outputPath salvo
        if(job.outputPath && fs.existsSync(job.outputPath)) {
             return res.download(job.outputPath);
        }
        return res.status(404).send("Arquivo não encontrado.");
    }
    res.download(path.join(UPLOAD_DIR, `render_${job.id}.mp4`));
});

// Proxy Pixabay (Fallback)
app.get('/api/proxy/pixabay', (req, res) => res.json({ hits: [] }));

// Frame Extraction (Fallback)
app.post('/api/util/extract-frame', uploadAny, (req, res) => res.status(500).send("Not implemented in this version"));

// Cleanup
setInterval(() => {
    const now = Date.now();
    Object.keys(jobs).forEach(id => {
        if (now - jobs[id].startTime > 3600000) delete jobs[id];
    });
}, 600000);

app.listen(PORT, '0.0.0.0', () => console.log(`\n🟢 SERVER ONLINE: http://0.0.0.0:${PORT}`));
