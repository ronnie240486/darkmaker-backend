
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

// --- SUBTITLE STYLES ENGINE (100+ MODELS) ---
// FFmpeg ASS format: &HBBGGRR (Blue-Green-Red)
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

// Helper to generate styles
const genStyle = (name, font, primary, outline, back, borderStyle = 1, shadow = 0) => {
    return `Fontname=${font},${BASE},PrimaryColour=${primary},OutlineColour=${outline},BackColour=${back},BorderStyle=${borderStyle},Outline=${borderStyle === 3 ? 0 : 2},Shadow=${shadow}`;
};

const SUBTITLE_STYLES = {};

// 1. VIRAL (Impact Font) - 20 Styles
const viralColors = Object.entries(C);
viralColors.forEach(([name, color]) => {
    SUBTITLE_STYLES[`viral_${name.toLowerCase()}`] = genStyle(`Viral ${name}`, FONTS.Impact, color, C.Black, C.Black, 1, 0);
});

// 2. CLEAN (Arial/Helvetica) - 20 Styles
viralColors.forEach(([name, color]) => {
    SUBTITLE_STYLES[`clean_${name.toLowerCase()}`] = genStyle(`Clean ${name}`, FONTS.Arial, color, C.Black, C.Black, 1, 1);
});

// 3. BOXED (Background Box) - 20 Styles
viralColors.forEach(([name, color]) => {
    // Box color is usually semi-transparent black (&H80000000) or contrasting
    SUBTITLE_STYLES[`box_${name.toLowerCase()}`] = genStyle(`Box ${name}`, FONTS.Verdana, color, C.Black, '&H80000000', 3, 0);
});

// 4. NEON (Glow effects via Outline/Shadow) - 15 Styles
const neonPairs = [['Cyan', C.Blue], ['Pink', C.Purple], ['Green', C.Lime], ['Yellow', C.Orange], ['White', C.Cyan]];
neonPairs.forEach(([name, outline], idx) => {
    SUBTITLE_STYLES[`neon_${name.toLowerCase()}`] = `Fontname=Verdana,${BASE},PrimaryColour=${C[name]},OutlineColour=${outline},BorderStyle=1,Outline=2,Shadow=2`;
    SUBTITLE_STYLES[`neon_bold_${name.toLowerCase()}`] = `Fontname=Impact,${BASE},PrimaryColour=${C[name]},OutlineColour=${outline},BorderStyle=1,Outline=3,Shadow=0`;
    SUBTITLE_STYLES[`neon_light_${name.toLowerCase()}`] = `Fontname=Arial,${BASE},PrimaryColour=${C[name]},OutlineColour=${outline},BorderStyle=1,Outline=1,Shadow=4`;
});

// 5. CINEMATIC (Serif) - 10 Styles
SUBTITLE_STYLES['cine_gold'] = genStyle('Cine Gold', FONTS.Times, C.Gold, C.Black, C.Black, 1, 1);
SUBTITLE_STYLES['cine_white'] = genStyle('Cine White', FONTS.Times, C.White, '&H40000000', C.Black, 1, 1);
SUBTITLE_STYLES['cine_silver'] = genStyle('Cine Silver', FONTS.Times, C.Silver, C.Black, C.Black, 1, 1);
SUBTITLE_STYLES['cine_classic'] = `Fontname=Georgia,${BASE},PrimaryColour=${C.White},OutlineColour=${C.Black},BorderStyle=1,Outline=1,Shadow=1,Italic=1`;

// 6. RETRO (Courier/Pixel) - 10 Styles
SUBTITLE_STYLES['retro_green'] = genStyle('Retro Green', FONTS.Courier, C.Green, C.Black, '&H80000000', 3, 0);
SUBTITLE_STYLES['retro_amber'] = genStyle('Retro Amber', FONTS.Courier, C.Orange, C.Black, '&H80000000', 3, 0);
SUBTITLE_STYLES['retro_white'] = genStyle('Retro White', FONTS.Courier, C.White, C.Black, '&H80000000', 3, 0);

// 7. FUN/COMIC - 10 Styles
SUBTITLE_STYLES['comic_yellow'] = genStyle('Comic Yellow', FONTS.Comic, C.Yellow, C.Black, C.Black, 1, 2);
SUBTITLE_STYLES['comic_white'] = genStyle('Comic White', FONTS.Comic, C.White, C.Black, C.Black, 1, 2);
SUBTITLE_STYLES['comic_cyan'] = genStyle('Comic Cyan', FONTS.Comic, C.Cyan, C.Blue, C.Black, 1, 0);

// Ensure defaults exist
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
        const videoClipDurations = []; // To track the actual length of generated video clips

        // DETERMINAR A DURAÇÃO DA TRANSIÇÃO E PADDING
        // Se houver transição, precisamos de padding no áudio para que o overlap aconteça no silêncio
        const transitionDuration = transition === 'cut' ? 0 : 1.0;
        
        // Start Padding: Adiciona silêncio no início do clipe igual à duração da transição.
        // Isso permite que o 'xfade' do clipe anterior termine sobre este silêncio, sem comer a fala.
        const startPadding = transition === 'cut' ? 0.1 : transitionDuration; 
        
        // End Padding: Adiciona silêncio no final.
        const endPadding = transition === 'cut' ? 0.1 : transitionDuration;

        // PASSO 1: Gerar clipes individuais com Padding de Áudio e Vídeo Estendido
        for (let i = 0; i < sortedScenes.length; i++) {
            const scene = sortedScenes[i];
            const clipPath = path.join(uploadDir, `temp_clip_${job.id}_${i}.mp4`);
            const args = [];
            
            // Duração do áudio (fala real)
            const audioDuration = scenesData[i]?.duration || 5;
            
            // Duração TOTAL do Clipe = StartPad + Audio + EndPad
            // Isso garante que o vídeo dure tempo suficiente para acomodar os silêncios extras
            const videoClipDuration = startPadding + audioDuration + endPadding;
            videoClipDurations.push(videoClipDuration);

            // Filtro de Movimento com buffer extra
            const moveFilter = getMovementFilter(movement, videoClipDuration + 2.0, targetW, targetH);

            // Filtro de Áudio: Adiciona delay no início (silêncio inicial) e garante padding no final
            // adelay=500|500 -> adiciona 500ms de silêncio no início (se startPadding for 0.5s)
            // apad -> permite que o áudio seja estendido para combinar com o vídeo (cortado pelo -t)
            const delayMs = Math.floor(startPadding * 1000);
            const audioFilter = `adelay=${delayMs}|${delayMs},apad`;

            if (scene.visual) {
                if (scene.visual.mimetype.includes('image')) {
                    args.push('-framerate', '30', '-loop', '1', '-i', scene.visual.path);
                    if (scene.audio) {
                        args.push('-i', scene.audio.path);
                    } else {
                        args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
                    }
                    
                    // Aplica movimento, filtro de áudio com delay, e corta no tempo total estendido
                    args.push('-vf', moveFilter, '-af', audioFilter, '-t', videoClipDuration.toString(), ...getVideoArgs(), ...getAudioArgs(), '-ac', '2', clipPath);
                } else {
                    // Se for vídeo, fazemos loop e cortamos
                    args.push('-stream_loop', '-1', '-i', scene.visual.path);
                    if (scene.audio) {
                        args.push('-i', scene.audio.path);
                    } else {
                        args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
                    }
                    args.push('-map', '0:v', '-map', '1:a', 
                        '-vf', `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,fps=30,format=yuv420p`, 
                        '-af', audioFilter, 
                        '-t', videoClipDuration.toString(), 
                        ...getVideoArgs(), ...getAudioArgs(), clipPath
                    );
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
            
            scenesData.forEach((sd, idx) => {
                const audioDur = sd.duration || 5;
                if (!sd.narration) return;
                
                // AJUSTE DE TEMPO DA LEGENDA:
                // O clipe começa com 'startPadding' de silêncio. A fala começa APÓS esse tempo.
                // A transição come parte desse startPadding, mas o tempo global avança.
                
                // Se usamos transição, o 'offset' come o startPadding do próximo clipe.
                // Mas no contexto global, a legenda deve aparecer quando a fala começa.
                
                // Início da fala neste clipe = currentTime + startPadding
                // Fim da fala = Início + audioDur
                
                const startTime = currentTime + startPadding;
                const endTime = startTime + audioDur;

                srtContent += `${idx + 1}\n${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}\n${sd.narration}\n\n`;
                
                // O tempo global avança a duração da fala + os paddings, MENOS o overlap da transição
                // Na concatenação com overlap: Duração Efetiva = Duração Total - Overlap
                // Mas espere! Se overlap é 'transitionDuration', ele consome o endPadding do atual e startPadding do próximo.
                // A duração "visível" exclusiva deste clipe é (startPad + audio + endPad) - overlap.
                
                // Simplificação: A próxima legenda começa quando a próxima fala começa.
                // Próxima fala começa após: (startPad deste) + (audio deste) + (endPad deste - overlap) + (overlap) + (startPad do próximo - overlap)... complicado.
                
                // Abordagem Segura:
                // O clipe 1 tem duração total T1.
                // O clipe 2 começa em T1 - overlap.
                // A fala do clipe 2 começa em (T1 - overlap) + startPadding.
                
                // Atualizamos currentTime para o "ponto de inserção" do próximo clipe
                const totalClipDuration = startPadding + audioDur + endPadding;
                const overlap = i === 0 ? 0 : transitionDuration; // O primeiro não tem overlap anterior
                
                // O próximo clipe será inserido em currentTime + totalClipDuration - transitionDuration
                // Mas currentTime aqui é o INÍCIO deste clipe.
                
                currentTime += totalClipDuration - transitionDuration;
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
            
            // Passa as durações estendidas para o calculador de transição
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
