
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

// TURBO ARGS: 24fps, ultrafast, zerolatency (inicia instantâneo)
const getVideoArgs = () => [
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline', 
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-r', '24' 
];

const getAudioArgs = () => [
    '-c:a', 'aac',
    '-b:a', '128k', 
    '-ar', '44100'
];

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

// --- SUBTITLE STYLES ENGINE ---
const C = {
    Yellow: '&H0000FFFF', Green: '&H0000FF00', Red: '&H000000FF', Cyan: '&H00FFFF00',
    White: '&H00FFFFFF', Black: '&H00000000', Orange: '&H0000A5FF', Pink: '&H009314FF',
    Purple: '&H00800080', Blue: '&H00FF0000', Gold: '&H0000D7FF', Grey: '&H00E0E0E0',
    Lime: '&H0000FF80', Magenta: '&H00FF00FF', Teal: '&H00808000', Navy: '&H00800000',
    Maroon: '&H00000080', Olive: '&H00008080', Silver: '&H00C0C0C0', Aqua: '&H00FFFF00'
};

const FONTS = {
    Impact: 'Impact', Arial: 'Arial', Verdana: 'Verdana', 
    Helvetica: 'Helvetica', Times: 'Times New Roman', Courier: 'Courier New',
    Comic: 'Comic Sans MS', Tahoma: 'Tahoma', Georgia: 'Georgia', Trebuchet: 'Trebuchet MS'
};

const BASE = "FontSize=24,Bold=1,Alignment=2,MarginV=50";

const genStyle = (name, font, primary, outline, back, borderStyle = 1, shadow = 0) => {
    return `Fontname=${font},${BASE},PrimaryColour=${primary},OutlineColour=${outline},BackColour=${back},BorderStyle=${borderStyle},Outline=${borderStyle === 3 ? 0 : 2},Shadow=${shadow}`;
};

const SUBTITLE_STYLES = {};

const viralColors = Object.entries(C);
viralColors.forEach(([name, color]) => {
    SUBTITLE_STYLES[`viral_${name.toLowerCase()}`] = genStyle(`Viral ${name}`, FONTS.Impact, color, C.Black, C.Black, 1, 0);
});
viralColors.forEach(([name, color]) => {
    SUBTITLE_STYLES[`clean_${name.toLowerCase()}`] = genStyle(`Clean ${name}`, FONTS.Arial, color, C.Black, C.Black, 1, 1);
});
viralColors.forEach(([name, color]) => {
    SUBTITLE_STYLES[`box_${name.toLowerCase()}`] = genStyle(`Box ${name}`, FONTS.Verdana, color, C.Black, '&H80000000', 3, 0);
});
const neonPairs = [['Cyan', C.Blue], ['Pink', C.Purple], ['Green', C.Lime], ['Yellow', C.Orange], ['White', C.Cyan]];
neonPairs.forEach(([name, outline], idx) => {
    SUBTITLE_STYLES[`neon_${name.toLowerCase()}`] = `Fontname=Verdana,${BASE},PrimaryColour=${C[name]},OutlineColour=${outline},BorderStyle=1,Outline=2,Shadow=2`;
    SUBTITLE_STYLES[`neon_bold_${name.toLowerCase()}`] = `Fontname=Impact,${BASE},PrimaryColour=${C[name]},OutlineColour=${outline},BorderStyle=1,Outline=3,Shadow=0`;
    SUBTITLE_STYLES[`neon_light_${name.toLowerCase()}`] = `Fontname=Arial,${BASE},PrimaryColour=${C[name]},OutlineColour=${outline},BorderStyle=1,Outline=1,Shadow=4`;
});
SUBTITLE_STYLES['cine_gold'] = genStyle('Cine Gold', FONTS.Times, C.Gold, C.Black, C.Black, 1, 1);
SUBTITLE_STYLES['cine_white'] = genStyle('Cine White', FONTS.Times, C.White, '&H40000000', C.Black, 1, 1);
SUBTITLE_STYLES['cine_silver'] = genStyle('Cine Silver', FONTS.Times, C.Silver, C.Black, C.Black, 1, 1);
SUBTITLE_STYLES['cine_classic'] = `Fontname=Georgia,${BASE},PrimaryColour=${C.White},OutlineColour=${C.Black},BorderStyle=1,Outline=1,Shadow=1,Italic=1`;
SUBTITLE_STYLES['retro_green'] = genStyle('Retro Green', FONTS.Courier, C.Green, C.Black, '&H80000000', 3, 0);
SUBTITLE_STYLES['retro_amber'] = genStyle('Retro Amber', FONTS.Courier, C.Orange, C.Black, '&H80000000', 3, 0);
SUBTITLE_STYLES['retro_white'] = genStyle('Retro White', FONTS.Courier, C.White, C.Black, '&H80000000', 3, 0);
SUBTITLE_STYLES['comic_yellow'] = genStyle('Comic Yellow', FONTS.Comic, C.Yellow, C.Black, C.Black, 1, 2);
SUBTITLE_STYLES['comic_white'] = genStyle('Comic White', FONTS.Comic, C.White, C.Black, C.Black, 1, 2);
SUBTITLE_STYLES['comic_cyan'] = genStyle('Comic Cyan', FONTS.Comic, C.Cyan, C.Blue, C.Black, 1, 0);
SUBTITLE_STYLES['viral_yellow'] = SUBTITLE_STYLES['viral_yellow'] || genStyle('Viral Yellow', FONTS.Impact, C.Yellow, C.Black, C.Black, 1, 0);

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
        const videoClipDurations = []; 

        // Se houver transição, precisamos de padding extra nas pontas para o crossfade (xfade)
        // Isso garante que o áudio não seja "comido" durante a mistura.
        const transitionDuration = transition === 'cut' ? 0 : 1.0;
        const padding = transition === 'cut' ? 0 : transitionDuration; 

        // PASSO 1: GERAR CLIPES INDIVIDUAIS
        for (let i = 0; i < sortedScenes.length; i++) {
            const scene = sortedScenes[i];
            
            // ATUALIZA O PROGRESSO A CADA CENA PROCESSADA
            if(jobs[job.id]) {
                const percentPerScene = 75 / sortedScenes.length;
                jobs[job.id].progress = Math.floor(5 + (i * percentPerScene));
            }

            const clipPath = path.join(uploadDir, `temp_clip_${job.id}_${i}.mp4`);
            const args = [];
            
            // --- CORREÇÃO CRÍTICA DE SINCRONIA ---
            // Não confiamos apenas no metadado 'duration' enviado pelo frontend.
            // Sondamos o arquivo físico de áudio para pegar a duração exata.
            let exactAudioDuration = scenesData[i]?.duration || 5;
            
            if (scene.audio) {
                const probeDur = await getExactDuration(scene.audio.path);
                if (probeDur > 0) {
                    exactAudioDuration = probeDur;
                }
            }

            // A duração total do vídeo deve ser: Padding Inicial + Duração Real do Áudio + Padding Final
            const totalClipDuration = padding + exactAudioDuration + padding;
            videoClipDurations.push(totalClipDuration);

            const moveFilter = getMovementFilter(movement, totalClipDuration + 2.0, targetW, targetH);

            const delayMs = Math.floor(padding * 1000);
            
            // Filtro de Áudio:
            // adelay: Adiciona silêncio no início para casar com o padding de vídeo
            // apad: Preenche com silêncio no final se o áudio for menor que o vídeo (segurança)
            let audioFilter = "apad";
            if (delayMs > 0) {
                audioFilter = `adelay=${delayMs}|${delayMs},apad`;
            }

            if (scene.visual) {
                if (scene.visual.mimetype.includes('image')) {
                    // Imagem Estática: Loop infinito (-loop 1) e corta (-t) na duração exata calculada
                    args.push('-framerate', '24', '-loop', '1', '-i', scene.visual.path);
                    
                    if (scene.audio) {
                        args.push('-i', scene.audio.path);
                    } else {
                        // Silêncio gerado se não houver áudio
                        args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
                    }
                    
                    args.push(
                        '-vf', moveFilter, 
                        '-af', audioFilter, 
                        '-t', totalClipDuration.toFixed(3), 
                        ...getVideoArgs(), ...getAudioArgs(), '-ac', '2', clipPath
                    );
                } else {
                    // Vídeo: Loop infinito (-stream_loop -1) para garantir que a imagem não suma antes do áudio
                    args.push('-stream_loop', '-1', '-i', scene.visual.path);
                    if (scene.audio) {
                        args.push('-i', scene.audio.path);
                    } else {
                        args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
                    }
                    args.push('-map', '0:v', '-map', '1:a', 
                        '-vf', `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,fps=24,format=yuv420p`, 
                        '-af', audioFilter, 
                        '-t', totalClipDuration.toFixed(3), 
                        ...getVideoArgs(), ...getAudioArgs(), clipPath
                    );
                }
            }
            await runFFmpeg(args, job.id);
            clipPaths.push(clipPath);
            tempFiles.push(clipPath);
        }

        // PASSO 2: LEGENDAS
        let srtPath = "";
        let forceStyle = SUBTITLE_STYLES[subtitleStyleKey] || SUBTITLE_STYLES['viral_yellow'];

        if (renderSubtitles && scenesData.length > 0) {
            let srtContent = "";
            let globalTimelineCursor = 0; 
            
            // Recalcula legendas baseado nos tempos reais (probe) se possível
            // Como já calculamos videoClipDurations com base nos arquivos reais, usamos essa lógica
            
            for(let idx = 0; idx < scenesData.length; idx++) {
                const sd = scenesData[idx];
                // Recupera a duração real usada no passo 1 (remove padding para saber duração da fala)
                const realAudioDuration = videoClipDurations[idx] - (padding * 2); 
                
                if (sd.narration) {
                    const startTime = globalTimelineCursor + padding;
                    const endTime = startTime + realAudioDuration;
                    srtContent += `${idx + 1}\n${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}\n${sd.narration}\n\n`;
                }
                
                // Avança cursor: Duração Total do Clipe - Sobreposição da Transição
                globalTimelineCursor += (videoClipDurations[idx] - transitionDuration);
            }
            
            srtPath = path.join(uploadDir, `subs_${job.id}.srt`);
            fs.writeFileSync(srtPath, srtContent);
            tempFiles.push(srtPath);
        }

        // PASSO 3: CONCATENAÇÃO FINAL
        if(jobs[job.id]) jobs[job.id].progress = 80;

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
            
            let { filterComplex, mapArgs } = buildTransitionFilter(clipPaths.length, transition, videoClipDurations, transitionDuration);
            
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
            let p = Math.round((cur / expectedDuration) * 20); 
            if (jobs[jobId]) jobs[jobId].progress = 80 + p;
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
