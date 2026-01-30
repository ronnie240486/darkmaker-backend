
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

// IMPORTAÇÃO DOS PRESETS DE MOVIMENTO E TRANSIÇÃO
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

// CONFIGURAÇÃO TURBO (ULTRAFAST)
const getVideoArgs = () => [
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline', 
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-r', '24',
    '-threads', '0' 
];

const getAudioArgs = () => [
    '-c:a', 'aac',
    '-b:a', '192k', 
    '-ar', '44100'
];

const getExactDuration = (filePath) => {
    return new Promise((resolve) => {
        execFile(ffprobePath.path, [
            '-v', 'error', 
            '-show_entries', 'format=duration', 
            '-of', 'default=noprint_wrappers=1:nokey=1', 
            filePath
        ], (err, stdout) => {
            if (err) resolve(0);
            else {
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
app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ extended: true, limit: '1000mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/outputs', express.static(OUTPUT_DIR));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9_.]/g, '_')}`)
});
const uploadAny = multer({ storage }).any();

const jobs = {};

// === PRESETS DE COR ===
const COLOR_PRESETS = {
    'realistic': 'eq=saturation=1.1,colorbalance=rm=0.05:gm=0.05:bm=-0.05',
    'vintage': 'colorbalance=rs=0.2:bs=-0.2,eq=gamma=1.2:saturation=0.8,vignette',
    'teal_orange': 'colorbalance=rs=0.1:gs=-0.1:bs=-0.2:rm=-0.1:gm=-0.05:bm=0.1:rh=0.1:gh=0.1:bh=-0.1,eq=saturation=1.2',
    'bw_noir': 'hue=s=0,eq=contrast=1.6:brightness=-0.1,vignette',
    'cyberpunk': 'colorbalance=bs=0.3:rs=0.2,eq=saturation=1.4:contrast=1.2',
    'vibrant': 'eq=saturation=1.5:contrast=1.1'
};

// === GET AUDIO TOOL COMMAND ===
function getAudioToolCommand(action, inputFiles, params, outputPath) {
    const input = inputFiles[0]?.path;
    const args = [];

    // Join action uses concat demuxer, others use -i
    if (action !== 'join') args.push('-i', input);

    // Default encoder params
    const audioCodec = ['-c:a', 'libmp3lame', '-q:a', '2'];

    switch (action) {
        case 'clean-audio':
            // Highpass/Lowpass filter para limpar ruído
            args.push('-af', 'highpass=f=200,lowpass=f=3000,afftdn=nf=-25', ...audioCodec);
            break;
        case 'normalize':
            args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', ...audioCodec);
            break;
        case 'speed':
            const speed = parseFloat(params.speed || params.value || '1.0');
            // Chaining atempo filters for speeds outside 0.5 - 2.0
            let atempoChain = "";
            let currentSpeed = speed;
            while (currentSpeed > 2.0) { atempoChain += "atempo=2.0,"; currentSpeed /= 2.0; }
            while (currentSpeed < 0.5) { atempoChain += "atempo=0.5,"; currentSpeed *= 2.0; }
            atempoChain += `atempo=${currentSpeed}`;
            args.push('-af', atempoChain, ...audioCodec);
            break;
        case 'pitch': // Pitch Shifting (Pitch-Shift)
            const n = parseFloat(params.pitch || params.value || '0');
            // asetrate changes pitch AND speed. atempo compensates speed.
            // Formula: rate = 44100 * 2^(n/12)
            const newRate = Math.round(44100 * Math.pow(2, n / 12.0));
            // Compensate speed: tempo = 1 / 2^(n/12)
            const tempoVal = 1.0 / Math.pow(2, n / 12.0);
            
            // Build tempo chain for compensation
            let tempoFilter = "";
            let rem = tempoVal;
            while (rem > 2.0) { tempoFilter += ",atempo=2.0"; rem /= 2.0; }
            while (rem < 0.5) { tempoFilter += ",atempo=0.5"; rem *= 2.0; }
            tempoFilter += `,atempo=${rem}`;

            args.push('-af', `asetrate=${newRate},aresample=44100${tempoFilter}`, ...audioCodec);
            break;
        case 'bass-boost':
            const gain = params.gain || params.value || '10';
            args.push('-af', `bass=g=${gain}:f=100`, ...audioCodec);
            break;
        case 'reverb':
            args.push('-af', 'aecho=0.8:0.9:1000:0.3', ...audioCodec);
            break;
        case '8d-audio':
            args.push('-af', 'apulsator=hz=0.125', ...audioCodec);
            break;
        case 'reverse':
            args.push('-af', 'areverse', ...audioCodec);
            break;
        case 'join':
            const listPath = path.join(path.dirname(inputFiles[0].path), `join_audio_${Date.now()}.txt`);
            const fileLines = inputFiles.map(f => `file '${f.path}'`).join('\n');
            fs.writeFileSync(listPath, fileLines);
            args.push('-f', 'concat', '-safe', '0', '-i', listPath, ...audioCodec);
            break;
        case 'convert':
            const fmt = params.format || 'mp3';
            if (fmt === 'wav') args.push('-c:a', 'pcm_s16le');
            else if (fmt === 'ogg') args.push('-c:a', 'libvorbis');
            else args.push(...audioCodec);
            break;
        default:
            args.push(...audioCodec);
    }
    args.push(outputPath);
    return args;
}

// === GET VIDEO TOOL COMMAND ===
function getToolCommand(action, inputFiles, params, outputPath) {
    // Roteamento para Audio Tools se necessário
    const isAudioAction = ['clean-audio', 'pitch-shift', 'speed', 'bass-boost', 'reverb', 'normalize', '8d-audio', 'join'].includes(action);
    const isAudioFile = inputFiles[0]?.mimetype?.includes('audio');
    
    if (isAudioAction || (isAudioFile && action !== 'convert' && action !== 'join')) {
        // Mapeia nomes do frontend para backend de áudio se necessário
        let audioAction = action;
        if(action === 'pitch-shift') audioAction = 'pitch';
        return getAudioToolCommand(audioAction, inputFiles, params, outputPath);
    }

    const input = inputFiles[0]?.path;
    const args = [];

    if (action !== 'join') args.push('-i', input);

    switch (action) {
        case 'upscale':
            // Fake Upscale usando scale + unsharp para nitidez
            const targetRes = params.upscaleTarget === '4k' ? '3840:2160' : params.upscaleTarget === '2k' ? '2560:1440' : '1920:1080';
            args.push('-vf', `scale=${targetRes}:flags=lanczos,unsharp=5:5:1.0:5:5:0.0`, ...getVideoArgs(), '-c:a', 'copy');
            break;
        
        case 'interpolation':
            const fps = params.targetFps || '60';
            const slowMo = params.slowMo === 'true' || params.slowMo === true;
            // minterpolate é pesado, mas é a única opção FFmpeg nativa para isso
            const filter = `minterpolate='mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:fps=${fps}'`;
            if (slowMo) {
                args.push('-vf', `${filter},setpts=2.0*PTS`, '-r', fps, ...getVideoArgs()); // Slow motion requires re-encoding
            } else {
                args.push('-vf', filter, '-r', fps, ...getVideoArgs());
            }
            break;

        case 'colorize':
            const style = params.style || 'realistic';
            let colorFilter = COLOR_PRESETS[style] || COLOR_PRESETS['realistic'];
            args.push('-vf', colorFilter, ...getVideoArgs(), '-c:a', 'copy');
            break;

        case 'stabilize':
            // Deshake filter
            args.push('-vf', 'deshake', ...getVideoArgs(), '-c:a', 'copy');
            break;

        case 'motion-blur':
            // Simula motion blur misturando frames (tmix) ou minterpolate shutter
            const shutter = params.shutter || '180'; // Angle
            // minterpolate pode simular shutter blur
            args.push('-vf', `minterpolate=fps=24:mi_mode=mci:mc_mode=aobmc:shutter_angle=${shutter}`, ...getVideoArgs());
            break;

        case 'clean-video':
            const strength = params.strength === 'high' ? '6.0' : params.strength === 'low' ? '2.0' : '4.0';
            args.push('-vf', `hqdn3d=${strength}:${strength}:3.0:3.0`, ...getVideoArgs(), '-c:a', 'copy');
            break;

        case 'cut':
            const start = params.start || '0';
            const end = params.end;
            args.push('-ss', start);
            if (end) args.push('-to', end);
            args.push('-c', 'copy'); // Fast cut without re-encode
            break;

        case 'join':
            const listPath = path.join(path.dirname(inputFiles[0].path), `join_vid_${Date.now()}.txt`);
            const fileLines = inputFiles.map(f => `file '${f.path}'`).join('\n');
            fs.writeFileSync(listPath, fileLines);
            args.push('-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy');
            break;

        case 'compress':
            const crf = params.crf || '28';
            args.push('-c:v', 'libx264', '-crf', crf, '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k');
            break;

        case 'convert':
            const outFormat = params.format || 'mp4';
            if(outFormat === 'mp4') args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac');
            else if (outFormat === 'webm') args.push('-c:v', 'libvpx-vp9', '-b:v', '2M', '-c:a', 'libopus');
            else args.push(...getVideoArgs()); // Default fallback
            break;

        case 'reverse':
            // Reverse video and audio segments
            args.push('-vf', 'reverse', '-af', 'areverse', ...getVideoArgs());
            break;

        case 'speed':
            // Video Speed
            const vSpeed = parseFloat(params.speed || '1.0');
            const setpts = (1 / vSpeed).toFixed(4);
            // Audio Speed Compensation
            let aFilter = "";
            let s = vSpeed;
            while(s > 2.0) { aFilter += "atempo=2.0,"; s/=2.0; }
            while(s < 0.5) { aFilter += "atempo=0.5,"; s*=2.0; }
            aFilter += `atempo=${s}`;
            
            args.push('-filter_complex', `[0:v]setpts=${setpts}*PTS[v];[0:a]${aFilter}[a]`, '-map', '[v]', '-map', '[a]', ...getVideoArgs());
            break;

        case 'resize':
            const ratio = params.ratio || '16:9';
            let scaleFilter = "scale=1280:720";
            if (ratio === '9:16') scaleFilter = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280";
            if (ratio === '1:1') scaleFilter = "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080";
            if (ratio === '4:3') scaleFilter = "scale=1024:768:force_original_aspect_ratio=increase,crop=1024:768";
            args.push('-vf', scaleFilter, ...getVideoArgs(), '-c:a', 'copy');
            break;

        case 'watermark':
            const text = params.text || "Watermark";
            const pos = params.position || "bottom-right";
            let posExp = "x=w-tw-10:y=h-th-10";
            if (pos === 'bottom-left') posExp = "x=10:y=h-th-10";
            if (pos === 'top-right') posExp = "x=w-tw-10:y=10";
            if (pos === 'center') posExp = "x=(w-text_w)/2:y=(h-text_h)/2";
            
            // Drawtext requires fontfile, using generic sans if available or just default font
            args.push('-vf', `drawtext=text='${text}':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.5:boxborderw=5:${posExp}`, ...getVideoArgs(), '-c:a', 'copy');
            break;

        case 'gif':
            const gifW = params.width || '480';
            const gifFps = params.fps || '15';
            args.push('-vf', `fps=${gifFps},scale=${gifW}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`);
            break;

        case 'remove-audio':
            args.push('-c:v', 'copy', '-an');
            break;

        case 'extract-audio':
            args.push('-vn', '-c:a', 'libmp3lame', '-q:a', '2');
            break;

        default:
            args.push('-c', 'copy');
    }
    args.push(outputPath);
    return args;
}

// === FUNÇÕES UTILITÁRIAS ===
function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return (parseFloat(parts[0]) * 3600) + (parseFloat(parts[1]) * 60) + parseFloat(parts[2]);
}

function createFFmpegJob(jobId, args, expectedDuration, res) {
    if (!jobs[jobId]) return;
    jobs[jobId].status = 'processing';
    if (res && !res.headersSent) res.status(202).json({ jobId });
    
    console.log(`[JOB ${jobId}] CMD: ffmpeg ${args.join(' ')}`);
    const ffmpeg = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-stats', '-y', ...args]);
    
    ffmpeg.stderr.on('data', d => {
        const line = d.toString();
        if(line.includes('time=')) {
             const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
             if (timeMatch && expectedDuration > 0) {
                const cur = timeToSeconds(timeMatch[1]);
                let p = Math.round((cur / expectedDuration) * 100);
                if (p > 99) p = 99; 
                if (jobs[jobId]) jobs[jobId].progress = p;
            }
        }
    });

    ffmpeg.on('close', code => {
        if (!jobs[jobId]) return;
        if (code === 0) {
            jobs[jobId].status = 'completed';
            jobs[jobId].progress = 100;
            jobs[jobId].downloadUrl = `/outputs/${path.basename(args[args.length - 1])}`;
        } else {
            console.error(`[JOB ${jobId}] Falha: ${code}`);
            jobs[jobId].status = 'failed';
            jobs[jobId].error = 'FFmpeg processing failed code ' + code;
        }
    });
}

// === ENGINE DE EXPORTAÇÃO FRAGMENTADA (TURBO) ===
// (Código completo da renderização turbo para vídeos longos)
async function handleExport(job, uploadDir, callback) {
    const outputName = `render_${job.id}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    
    let jobConfig = job.params;
    if (typeof jobConfig === 'string') {
        try { jobConfig = JSON.parse(jobConfig); } catch(e) {}
    } else if (jobConfig && jobConfig.config) {
        if (typeof jobConfig.config === 'string') {
            try { jobConfig = JSON.parse(jobConfig.config); } catch(e) {}
        } else { jobConfig = jobConfig.config; }
    }

    const movement = jobConfig?.movement || 'static';
    const aspectRatio = jobConfig?.aspectRatio || '16:9';
    let musicVolume = parseFloat(jobConfig?.musicVolume || 0.2);
    let sfxVolume = parseFloat(jobConfig?.sfxVolume || 0.5);

    let targetW = 1280, targetH = 720;
    if (aspectRatio === '9:16') { targetW = 720; targetH = 1280; }

    try {
        const sceneMap = {};
        let bgMusicFile = null;

        job.files.forEach(f => {
            if (f.originalname.includes('background_music')) bgMusicFile = f;
            else {
                const match = f.originalname.match(/scene_(\d+)(?:_(visual|audio|sfx))?\.?/);
                if (match) {
                    const idx = parseInt(match[1]);
                    let type = match[2] || 'visual';
                    if (!match[2]) {
                        if (f.mimetype.includes('audio')) type = 'audio';
                        else type = 'visual';
                    }
                    if (f.originalname.includes('sfx')) type = 'sfx';
                    if (!sceneMap[idx]) sceneMap[idx] = {};
                    sceneMap[idx][type] = f;
                }
            }
        });

        const sortedScenes = Object.keys(sceneMap).sort((a,b) => a - b).map(k => sceneMap[k]);
        const clipPaths = [];
        const videoClipDurations = [];

        // PASSO 1: RENDERIZAR CADA CENA INDIVIDUALMENTE
        for (let i = 0; i < sortedScenes.length; i++) {
            const scene = sortedScenes[i];
            const clipPath = path.join(uploadDir, `temp_${job.id}_${i}.mp4`);
            
            let dur = 5;
            if (scene.audio) dur = (await getExactDuration(scene.audio.path)) || dur;
            videoClipDurations.push(dur);

            const args = [];
            
            // Input Visual
            if (scene.visual?.mimetype?.includes('image')) {
                args.push('-framerate', '24', '-loop', '1', '-i', scene.visual.path);
            } else if (scene.visual) {
                args.push('-stream_loop', '-1', '-i', scene.visual.path);
            } else {
                args.push('-f', 'lavfi', '-i', `color=c=black:s=${targetW}x${targetH}:d=${dur}`);
            }

            // Input Áudio (Voz)
            if (scene.audio) args.push('-i', scene.audio.path);
            else args.push('-f', 'lavfi', '-i', 'anullsrc=cl=stereo:sr=44100');

            // Input SFX (Opcional)
            let filterComplex = "";
            let audioMap = "1:a";
            if (scene.sfx) {
                args.push('-i', scene.sfx.path);
                filterComplex += `[1:a]volume=1.5[voice];[2:a]volume=${sfxVolume}[sfx];[voice][sfx]amix=inputs=2:duration=first[mixed_a];`;
                audioMap = "[mixed_a]";
            } else {
                filterComplex += `[1:a]volume=1.5[mixed_a];`;
                audioMap = "[mixed_a]";
            }

            // Filtro de Movimento e Scale
            const moveFilter = getMovementFilter(movement, dur, targetW, targetH);
            
            if (scene.visual?.mimetype?.includes('image')) {
                filterComplex += `[0:v]${moveFilter}[v_out]`;
            } else {
                filterComplex += `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,fps=24,format=yuv420p[v_out]`;
            }

            args.push(
                '-filter_complex', filterComplex,
                '-map', '[v_out]',
                '-map', audioMap,
                '-t', dur.toFixed(3),
                ...getVideoArgs(), 
                ...getAudioArgs(),
                clipPath
            );

            await new Promise((resolve, reject) => {
                const p = spawn(ffmpegPath, ['-y', ...args]);
                p.on('close', c => c === 0 ? resolve() : reject(new Error(`Erro ao renderizar cena ${i}`)));
            });
            clipPaths.push(clipPath);
            if(jobs[job.id]) jobs[job.id].progress = Math.round((i / sortedScenes.length) * 80);
        }

        // PASSO 2: CONCATENAR TUDO (ULTRA FAST)
        const listPath = path.join(uploadDir, `list_${job.id}.txt`);
        const fileContent = clipPaths.map(p => `file '${path.resolve(p).replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(listPath, fileContent);
        
        let finalArgs = ['-f', 'concat', '-safe', '0', '-i', listPath];
        
        if (bgMusicFile) {
            finalArgs.push('-i', bgMusicFile.path);
            finalArgs.push(
                '-filter_complex', `[1:a]volume=${musicVolume},aloop=loop=-1:size=2e+09[bgm];[0:a][bgm]amix=inputs=2:duration=first[a_final]`,
                '-map', '0:v', '-map', '[a_final]'
            );
        } else {
            finalArgs.push('-c', 'copy');
        }

        if (bgMusicFile) {
             finalArgs.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k');
        }
        
        finalArgs.push(outputPath);
        
        const totalDuration = videoClipDurations.reduce((a,b) => a+b, 0);
        callback(job.id, finalArgs, totalDuration);

        setTimeout(() => {
            clipPaths.forEach(p => { if(fs.existsSync(p)) fs.unlinkSync(p); });
            if(fs.existsSync(listPath)) fs.unlinkSync(listPath);
        }, 600000);

    } catch (e) {
        console.error("ERRO CRÍTICO NO EXPORT:", e);
        if (jobs[job.id]) { jobs[job.id].status = 'failed'; jobs[job.id].error = e.message; }
    }
}

// === ROTAS ===

app.post('/api/process/start/:action', uploadAny, (req, res) => {
    const action = req.params.action;
    const jobId = `${action}_${Date.now()}`;
    let ext = 'mp4';
    
    // Define extensão de saída baseada na ação
    if (['clean-audio', 'speed', 'pitch', 'bass-boost', 'reverb', 'normalize', '8d-audio', 'join'].includes(action)) {
        if (req.files[0]?.mimetype?.includes('audio')) ext = 'mp3';
        if (action === 'convert' && req.body.format) ext = req.body.format;
        if (action === 'extract-audio') ext = 'mp3';
    } else if (action === 'gif') {
        ext = 'gif';
    } else if (action === 'convert' && req.body.format) {
        ext = req.body.format;
    }

    const outputName = `processed_${jobId}.${ext}`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    
    jobs[jobId] = { id: jobId, status: 'pending', progress: 0, files: req.files, params: req.body, downloadUrl: null };
    
    try {
        let params = req.body;
        if (req.body.config) {
            try { params = JSON.parse(req.body.config); } catch(e){}
        }
        const args = getToolCommand(action, req.files, params, outputPath);
        // Estimate duration crudely or use default
        createFFmpegJob(jobId, args, 30, res);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
        jobs[jobId].status = 'failed';
    }
});

// Alias route for video editor
app.post('/api/edit/start/:action', uploadAny, (req, res) => {
    // Redirects to generic process route logic
    const action = req.params.action;
    const jobId = `edit_${action}_${Date.now()}`;
    const outputName = `edit_${jobId}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    
    jobs[jobId] = { id: jobId, status: 'pending', progress: 0, files: req.files, params: req.body, downloadUrl: null };
    
    try {
        let params = req.body;
        if (req.body.config) {
            try { params = JSON.parse(req.body.config); } catch(e){}
        }
        
        const args = getToolCommand(action, req.files, params, outputPath);
        createFFmpegJob(jobId, args, 30, res);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/image/start/:action', uploadAny, (req, res) => {
    // Para imagens, em um servidor real, usaríamos ImageMagick ou Sharp.
    // Como estamos focados em FFmpeg, vamos apenas devolver o arquivo original como mock 
    // ou fazer uma conversão simples se for supported.
    const action = req.params.action;
    const jobId = `img_${action}_${Date.now()}`;
    
    if(!req.files || req.files.length === 0) return res.status(400).json({error: "No file"});
    const file = req.files[0];
    const ext = path.extname(file.originalname);
    const outputName = `img_${jobId}${ext}`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    
    fs.copyFileSync(file.path, outputPath);
    
    jobs[jobId] = { id: jobId, status: 'completed', progress: 100, downloadUrl: `/outputs/${outputName}` };
    res.json({ jobId });
});

app.post('/api/render/start', uploadAny, (req, res) => {
    const jobId = `render_${Date.now()}`;
    jobs[jobId] = { id: jobId, status: 'processing', progress: 0, files: req.files, params: req.body, downloadUrl: null };
    res.status(202).json({ jobId });
    
    handleExport(jobs[jobId], UPLOAD_DIR, (id, args, dur) => createFFmpegJob(id, args, dur, null));
});

app.get('/api/process/status/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job) return res.status(404).json({ status: 'not_found' });
    res.json(job);
});

app.listen(PORT, '0.0.0.0', () => console.log(`Turbo Server Complete na porta ${PORT}`));
