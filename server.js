
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import * as esbuild from 'esbuild';

// IMPORTAÇÃO DOS PRESETS (Pastas criadas conforme solicitado)
import { getMovementFilter } from './presets/movements.js';
import { buildTransitionFilter } from './presets/transitions.js';

// Configuração de diretórios (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Garantir diretórios principais
[UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

console.log("\x1b[36m%s\x1b[0m", "\n🚀 [SERVER] Iniciando DarkMaker Engine (Modular)...");
console.log(`📂 Presets Carregados: movements.js, transitions.js`);

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
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/outputs', express.static(OUTPUT_DIR));

// --- UPLOAD CONFIG ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9_.]/g, '_')}`)
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

function runFFmpeg(args, jobId) {
    return new Promise((resolve, reject) => {
        console.log(`[Job ${jobId}] FFmpeg Cmd: ${args.join(' ')}`);
        const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
        
        let stderr = '';
        proc.stderr.on('data', d => stderr += d.toString());
        
        proc.on('close', code => {
            if (code === 0) {
                resolve();
            } else {
                console.error(`[Job ${jobId}] Erro FFmpeg:\n${stderr}`);
                reject(new Error(`FFmpeg error: ${stderr}`));
            }
        });
    });
}

// --- CORE JOB PROCESSING ---

// 1. Processamento Genérico
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
        
        if (action === 'extract-audio') outputExt = 'mp3';
        if (action === 'convert') outputExt = params.format || 'mp4';
        if (action === 'stems') outputExt = 'mp3';

        const outputPath = path.join(OUTPUT_DIR, `${action}_${jobId}.${outputExt}`);
        const args = [];

        switch (action) {
            case 'remove-audio': args.push('-i', inputPath, '-c:v', 'copy', '-an', outputPath); break;
            case 'extract-audio': args.push('-i', inputPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', outputPath); break;
            case 'compress': 
                if (outputExt === 'mp3') args.push('-i', inputPath, '-map', '0:a', '-b:a', '64k', outputPath);
                else args.push('-i', inputPath, '-vcodec', 'libx264', '-crf', '28', '-preset', 'fast', outputPath);
                break;
            case 'join':
                if (files.length < 2) throw new Error("Necessário pelo menos 2 arquivos.");
                const listPath = path.join(UPLOAD_DIR, `join_list_${jobId}.txt`);
                const listContent = files.map(f => `file '${f.path}'`).join('\n');
                fs.writeFileSync(listPath, listContent);
                args.push('-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath);
                break;
            case 'cut':
                const start = params.start || '00:00:00';
                const duration = params.duration || '10';
                args.push('-ss', start, '-i', inputPath, '-t', duration, '-c', 'copy', outputPath);
                break;
            case 'clean-video': args.push('-i', inputPath, '-vf', 'hqdn3d=1.5:1.5:6:6', '-c:a', 'copy', outputPath); break;
            case 'clean-audio': args.push('-i', inputPath, '-af', 'afftdn=nf=-25', outputPath); break;
            case 'stems': args.push('-i', inputPath, '-af', 'pan="stereo|c0=c0|c1=-1*c1"', outputPath); break;
            case 'convert': args.push('-i', inputPath, outputPath); break;
            default: args.push('-i', inputPath, outputPath);
        }
        
        jobs[jobId].progress = 50;
        await runFFmpeg(args, jobId);
        
        jobs[jobId].progress = 100;
        jobs[jobId].status = 'completed';
        jobs[jobId].downloadUrl = `/outputs/${path.basename(outputPath)}`;

    } catch (e) {
        jobs[jobId].status = 'failed';
        jobs[jobId].error = e.message;
    }
}

// 2. Renderização de Roteiro (Workflow Mágico / IA Turbo)
async function handleExport(job, uploadDir, callback) {
    const outputName = `render_${job.id}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    
    // Parâmetros vindos do Frontend
    const transition = job.params?.transition || 'cut'; 
    const movement = job.params?.movement || 'static';
    
    try {
        console.log(`[Job ${job.id}] Renderizando com Presets: T=${transition}, M=${movement}`);

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
        if (sortedScenes.length === 0) throw new Error("Nenhuma cena válida recebida.");

        const clipPaths = [];
        const tempFiles = [];
        const FORCE_DURATION = 5; 

        // GERAÇÃO DOS CLIPES INDIVIDUAIS
        for (let i = 0; i < sortedScenes.length; i++) {
            const scene = sortedScenes[i];
            const clipPath = path.join(uploadDir, `temp_clip_${job.id}_${i}.mp4`);
            const args = [];
            
            // Argumentos de Saída Normalizados
            const commonOutputArgs = [
                '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20',
                '-pix_fmt', 'yuv420p', '-r', '30',
                '-video_track_timescale', '90000', // Sincronia fina para o xfade
                '-c:a', 'aac', '-ar', '44100', '-ac', '2'
            ];
            
            if (scene.visual) {
                // Caso Imagem: Aplica Filtro de Movimento do Preset
                if (scene.visual.mimetype.includes('image')) {
                    const moveFilter = getMovementFilter(movement);
                    
                    // IMPORTANTE: -framerate 30 na entrada para estabilidade temporal
                    args.push(
                        '-framerate', '30', '-loop', '1', '-i', scene.visual.path
                    );

                    if (scene.audio) {
                        args.push(
                            '-i', scene.audio.path,
                            '-vf', moveFilter, 
                            '-af', 'apad', // CRÍTICO: Preenche áudio com silêncio se for curto
                            '-t', FORCE_DURATION.toString(), // CRÍTICO: Força duração exata de 5s
                            '-fflags', '+genpts'
                        );
                    } else {
                        // Sem áudio: gera silêncio de 5s
                        args.push(
                            '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
                            '-vf', moveFilter,
                            '-t', FORCE_DURATION.toString()
                        );
                    }
                    
                    args.push(...commonOutputArgs, clipPath);

                } else {
                    // Caso Vídeo: Normaliza para 16:9 720p
                    args.push('-i', scene.visual.path);
                    
                    if (scene.audio) args.push('-i', scene.audio.path);
                    else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');

                    args.push(
                        '-map', '0:v', '-map', '1:a',
                        '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,fps=30,format=yuv420p',
                        // Se o vídeo for menor que 5s, ele deve ser extendido ou mantido? 
                        // Idealmente para transições complexas, duração fixa é melhor, mas para vídeos deixamos -shortest por enquanto
                        // ou forçamos 5s se for curto? Vamos usar shortest aqui para não cortar vídeo longo.
                        // Mas para xfade, isso pode desalinhar se a duração for imprevisível.
                        // Para o modo "Shorts" ou "Magic", assumimos cenas curtas.
                        '-shortest', 
                        ...commonOutputArgs,
                        clipPath
                    );
                }
            } else {
                continue; 
            }

            console.log(`[Job ${job.id}] Clip ${i} OK.`);
            await runFFmpeg(args, job.id);
            clipPaths.push(clipPath);
            tempFiles.push(clipPath);
        }

        if (clipPaths.length === 0) throw new Error("Falha na geração de clipes.");

        // --- CONCATENAÇÃO FINAL ---
        let finalArgs = [];

        // Se for "cut" (corte seco), usa concat simples (muito mais rápido)
        if (transition === 'cut' || clipPaths.length === 1) {
            const listPath = path.join(uploadDir, `concat_list_${job.id}.txt`);
            const fileContent = clipPaths.map(p => `file '${p}'`).join('\n');
            fs.writeFileSync(listPath, fileContent);
            tempFiles.push(listPath);

            finalArgs = [
                '-f', 'concat', '-safe', '0', '-i', listPath,
                '-c', 'copy', outputPath
            ];
        } else {
            // Se tiver transição, usa o Preset de Transições Complexas
            const inputs = [];
            clipPaths.forEach(p => inputs.push('-i', p));
            
            // Assumimos duração fixa de 5s para o cálculo de offsets
            const { filterComplex, mapArgs } = buildTransitionFilter(clipPaths.length, transition, FORCE_DURATION, 1);
            
            finalArgs = [
                ...inputs,
                '-filter_complex', filterComplex,
                ...mapArgs,
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
                '-c:a', 'aac', '-b:a', '192k',
                outputPath
            ];
        }

        console.log(`[Job ${job.id}] Finalizando montagem...`);
        callback(job.id, finalArgs, clipPaths.length * 5);

        // Limpeza
        setTimeout(() => {
            tempFiles.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });
        }, 300000); 

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
        jobs[jobId].progress = 50; 
    }
    
    if (res && !res.headersSent) res.status(202).json({ jobId });

    const finalArgs = ['-hide_banner', '-loglevel', 'error', '-stats', '-y', ...args];
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
            if (jobs[jobId]) jobs[jobId].progress = 50 + (progress / 2);
        }
    });

    ffmpeg.on('close', (code) => {
        if (!jobs[jobId]) return;
        if (code === 0) {
            jobs[jobId].status = 'completed';
            jobs[jobId].progress = 100;
            const filename = path.basename(args[args.length - 1]);
            jobs[jobId].downloadUrl = `/outputs/${filename}`;
            console.log(`[Job ${jobId}] Sucesso.`);
        } else {
            console.error(`[Job ${jobId}] Erro Final:`, stderr);
            jobs[jobId].status = 'failed';
            jobs[jobId].error = "Erro na renderização final.";
        }
    });
}

// --- ROTAS API ---

app.post('/api/process/start/:action', uploadAny, (req, res) => {
    const action = req.params.action;
    const jobId = `${action}_${Date.now()}`;
    jobs[jobId] = { 
        id: jobId, status: 'pending', files: req.files, params: req.body, 
        downloadUrl: null, startTime: Date.now() 
    };
    res.status(202).json({ jobId });
    processGenericJob(jobId, action, req.files, req.body);
});

app.post('/api/export/start', uploadAny, (req, res) => {
    const jobId = `export_${Date.now()}`;
    jobs[jobId] = { 
        id: jobId, status: 'processing', progress: 5, files: req.files, 
        params: req.body, downloadUrl: null, startTime: Date.now() 
    };
    res.status(202).json({ jobId });

    handleExport(jobs[jobId], UPLOAD_DIR, (id, args, totalDuration) => {
        createFFmpegJob(id, args, totalDuration, null);
    });
});

app.get('/api/process/status/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job) return res.status(404).json({ status: 'not_found' });
    res.json(job);
});

app.get('/api/process/download/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (job && job.downloadUrl) return res.redirect(job.downloadUrl);
    res.status(404).send("Arquivo não encontrado.");
});

app.get('/api/health', (req, res) => res.send('OK'));

app.listen(PORT, '0.0.0.0', () => console.log(`\n🟢 SERVER ONLINE: http://0.0.0.0:${PORT}`));
