
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

import { getMovementFilter } from './presets/movements.js';
import { getTransitionXfade } from './presets/transitions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Garantir diretórios existem
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
    '-r', '30', 
    '-threads', '0' 
];

const getAudioArgs = () => [
    '-c:a', 'aac',
    '-b:a', '192k', 
    '-ar', '44100'
];

const getExactDuration = (filePath) => {
    return new Promise((resolve) => {
        if (!fs.existsSync(filePath)) {
            resolve(0);
            return;
        }
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
        const srcIndex = path.join(__dirname, 'index.html');
        const destIndex = path.join(PUBLIC_DIR, 'index.html');
        const srcCss = path.join(__dirname, 'index.css');
        const destCss = path.join(PUBLIC_DIR, 'index.css');

        if (fs.existsSync(srcIndex)) fs.copyFileSync(srcIndex, destIndex);
        if (fs.existsSync(srcCss)) fs.copyFileSync(srcCss, destCss);

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
    } catch (e) { 
        console.error("Build Warning (Non-critical):", e.message); 
    }
}
await buildFrontend();

app.use(cors());
app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ extended: true, limit: '1000mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/outputs', express.static(OUTPUT_DIR));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_')}`)
});
const uploadAny = multer({ storage }).any();

const jobs = {};

function getAudioToolCommand(action, inputFiles, params, outputPath) {
    const input = inputFiles[0]?.path;
    const args = [];
    if (action !== 'join') args.push('-i', input);
    const audioCodec = ['-c:a', 'libmp3lame', '-q:a', '2'];

    switch (action) {
        case 'clean-audio': args.push('-af', 'highpass=f=200,lowpass=f=3000,afftdn=nf=-25', ...audioCodec); break;
        case 'normalize': args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', ...audioCodec); break;
        case 'speed':
            const speed = parseFloat(params.speed || params.value || '1.0');
            let atempoChain = "";
            let currentSpeed = speed;
            while (currentSpeed > 2.0) { atempoChain += "atempo=2.0,"; currentSpeed /= 2.0; }
            while (currentSpeed < 0.5) { atempoChain += "atempo=0.5,"; currentSpeed *= 2.0; }
            atempoChain += `atempo=${currentSpeed}`;
            args.push('-af', atempoChain, ...audioCodec);
            break;
        case 'pitch':
            const n = parseFloat(params.pitch || params.value || '0');
            const newRate = Math.round(44100 * Math.pow(2, n / 12.0));
            const tempoVal = 1.0 / Math.pow(2, n / 12.0);
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
        case 'reverb': args.push('-af', 'aecho=0.8:0.9:1000:0.3', ...audioCodec); break;
        case '8d-audio': args.push('-af', 'apulsator=hz=0.125', ...audioCodec); break;
        case 'reverse': args.push('-af', 'areverse', ...audioCodec); break;
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
        default: args.push(...audioCodec);
    }
    args.push(outputPath);
    return args;
}

function getToolCommand(action, inputFiles, params, outputPath) {
    const isAudioAction = ['clean-audio', 'pitch-shift', 'speed', 'bass-boost', 'reverb', 'normalize', '8d-audio', 'join'].includes(action);
    const isAudioFile = inputFiles[0]?.mimetype?.includes('audio');
    
    if (isAudioAction || (isAudioFile && action !== 'convert' && action !== 'join')) {
        let audioAction = action;
        if(action === 'pitch-shift') audioAction = 'pitch';
        return getAudioToolCommand(audioAction, inputFiles, params, outputPath);
    }

    const input = inputFiles[0]?.path;
    const args = [];
    if (action !== 'join') args.push('-i', input);

    switch (action) {
        case 'upscale':
            const targetRes = params.upscaleTarget === '4k' ? '3840:2160' : params.upscaleTarget === '2k' ? '2560:1440' : '1920:1080';
            args.push('-vf', `scale=${targetRes}:flags=lanczos,unsharp=5:5:1.0:5:5:0.0`, ...getVideoArgs(), '-c:a', 'copy');
            break;
        case 'interpolation':
            const fps = params.targetFps || '60';
            const slowMo = params.slowMo === 'true' || params.slowMo === true;
            const filter = `minterpolate='mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:fps=${fps}'`;
            if (slowMo) args.push('-vf', `${filter},setpts=2.0*PTS`, '-r', fps, ...getVideoArgs());
            else args.push('-vf', filter, '-r', fps, ...getVideoArgs());
            break;
        case 'colorize':
            const colorFilter = 'eq=saturation=1.1'; // Simplificado
            args.push('-vf', colorFilter, ...getVideoArgs(), '-c:a', 'copy');
            break;
        case 'stabilize': args.push('-vf', 'deshake', ...getVideoArgs(), '-c:a', 'copy'); break;
        case 'motion-blur':
            const shutter = params.shutter || '180';
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
            args.push('-c', 'copy');
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
            else args.push(...getVideoArgs());
            break;
        case 'reverse': args.push('-vf', 'reverse', '-af', 'areverse', ...getVideoArgs()); break;
        case 'speed':
            const vSpeed = parseFloat(params.speed || '1.0');
            const setpts = (1 / vSpeed).toFixed(4);
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
            args.push('-vf', `drawtext=text='${text}':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.5:boxborderw=5:${posExp}`, ...getVideoArgs(), '-c:a', 'copy');
            break;
        case 'gif':
            const gifW = params.width || '480';
            const gifFps = params.fps || '15';
            args.push('-vf', `fps=${gifFps},scale=${gifW}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`);
            break;
        case 'remove-audio': args.push('-c:v', 'copy', '-an'); break;
        case 'extract-audio': args.push('-vn', '-c:a', 'libmp3lame', '-q:a', '2'); break;
        default: args.push('-c', 'copy');
    }
    args.push(outputPath);
    return args;
}

function createFFmpegJob(jobId, args, expectedDuration, res) {
    if (!jobs[jobId]) return;
    jobs[jobId].status = 'processing';
    if (res && !res.headersSent) res.status(202).json({ jobId });
    
    console.log(`[JOB ${jobId}] CMD: ffmpeg ${args.join(' ')}`);
    const ffmpeg = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-stats', '-y', ...args]);
    
    let stderrLog = "";

    ffmpeg.stderr.on('data', d => {
        const line = d.toString();
        stderrLog += line; 
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
            console.error(`[JOB ${jobId}] Failed. Code: ${code}`);
            console.error(`[JOB ${jobId}] Log Tail:`, stderrLog.slice(-500));
            jobs[jobId].status = 'failed';
            jobs[jobId].error = `FFmpeg Error (Code ${code}). Check server logs.`;
        }
    });
}

function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return (parseFloat(parts[0]) * 3600) + (parseFloat(parts[1]) * 60) + parseFloat(parts[2]);
}

// === ENGINE DE EXPORTAÇÃO FRAGMENTADA (TURBO V2) ===
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
    const transitionType = jobConfig?.transition || 'cut';
    const aspectRatio = jobConfig?.aspectRatio || '16:9';
    let musicVolume = parseFloat(jobConfig?.musicVolume || 0.2);
    let sfxVolume = parseFloat(jobConfig?.sfxVolume || 0.5);

    let targetW = 1280, targetH = 720;
    if (aspectRatio === '9:16') { targetW = 720; targetH = 1280; }

    try {
        const sceneMap = {};
        let bgMusicFile = null;

        job.files.forEach(f => {
            if (f.originalname.includes('background_music')) {
                bgMusicFile = f;
            } else {
                const match = f.originalname.match(/scene_(\d+)(?:_(sfx))?\.?/);
                if (match) {
                    const idx = parseInt(match[1]);
                    let type = 'visual';
                    if (match[2] === 'sfx') type = 'sfx';
                    else if (f.mimetype.includes('audio')) type = 'audio';
                    else type = 'visual';
                    
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
            
            let audioDur = 0;
            if (scene.audio) {
                audioDur = await getExactDuration(scene.audio.path);
            }
            const baseDur = audioDur > 0 ? audioDur : 5;
            const transDur = 1.0; 
            const safetyPad = 0.5;
            const totalSceneDur = baseDur + transDur + safetyPad;
            
            const args = [];
            
            // 1. Input Visual [0:v]
            // CORREÇÃO: Usar -loop 1 e -t explícito para garantir duração
            if (scene.visual?.mimetype?.includes('image')) {
                args.push('-loop', '1', '-t', (totalSceneDur + 2).toFixed(3), '-i', scene.visual.path);
            } else if (scene.visual) {
                args.push('-stream_loop', '-1', '-t', (totalSceneDur + 2).toFixed(3), '-i', scene.visual.path);
            } else {
                args.push('-f', 'lavfi', '-i', `color=c=black:s=${targetW}x${targetH}:d=${(totalSceneDur + 2).toFixed(3)}`);
            }

            // 2. Input Áudio (Voz) [1:a]
            if (scene.audio) {
                args.push('-i', scene.audio.path);
            } else {
                // IMPORTANT: Generate dummy audio to avoid map error.
                // FIX: Ensure duration is a valid number string to prevent 'invalid argument'.
                args.push('-f', 'lavfi', '-i', `anullsrc=cl=stereo:sr=44100:d=${(totalSceneDur + 2).toFixed(3)}`);
            }

            // 3. Input SFX (Opcional) [2:a]
            let hasSfx = false;
            if (scene.sfx) {
                args.push('-i', scene.sfx.path);
                hasSfx = true;
            }

            // Audio Mixing Logic 
            let filterComplex = "";
            let audioMap = "[a_out]";
            
            // Se tiver SFX, mistura. Se não, apenas passa o áudio (voz ou silêncio)
            if (hasSfx) {
                filterComplex += `[1:a]volume=1.5,apad=pad_dur=2,asetpts=PTS-STARTPTS[voice];[2:a]volume=${sfxVolume},apad=pad_dur=2,asetpts=PTS-STARTPTS[sfx];[voice][sfx]amix=inputs=2:duration=longest:dropout_transition=0,aresample=async=1[a_out];`;
            } else {
                filterComplex += `[1:a]volume=1.5,apad=pad_dur=2,asetpts=PTS-STARTPTS,aresample=async=1[a_out];`;
            }

            // Visual Movement & Scaling Logic
            // Ensure target dimension inputs are integers
            const moveFilter = getMovementFilter(movement, totalSceneDur, Math.floor(targetW), Math.floor(targetH));
            
            // Aplicar movimento ao input 0
            filterComplex += `[0:v]${moveFilter}[v_out]`;

            args.push(
                '-filter_complex', filterComplex,
                '-map', '[v_out]',
                '-map', audioMap,
                '-t', totalSceneDur.toFixed(3),
                ...getVideoArgs(), 
                ...getAudioArgs(),
                clipPath
            );

            await new Promise((resolve, reject) => {
                const p = spawn(ffmpegPath, ['-y', ...args]);
                let err = "";
                p.stderr.on('data', d => err += d.toString());
                p.on('close', c => {
                    if (c === 0) resolve();
                    else {
                        console.error(`Erro Render Cena ${i}:`, err.slice(-500));
                        reject(new Error(`Erro ao renderizar cena ${i}.`));
                    }
                });
            });
            
            const actualDur = await getExactDuration(clipPath);
            videoClipDurations.push(actualDur);
            clipPaths.push(clipPath);
            
            if(jobs[job.id]) jobs[job.id].progress = Math.round((i / sortedScenes.length) * 80);
        }

        // PASSO 2: CONCATENAÇÃO (CUT vs XFADE)
        let finalArgs = [];
        
        if (transitionType === 'cut' || clipPaths.length < 2) {
            // --- CONCAT SIMPLES (CUT) ---
            const listPath = path.join(uploadDir, `list_${job.id}.txt`);
            const fileContent = clipPaths.map(p => `file '${path.resolve(p).replace(/\\/g, '/')}'`).join('\n');
            fs.writeFileSync(listPath, fileContent);
            
            finalArgs = ['-f', 'concat', '-safe', '0', '-i', listPath];
            
            if (bgMusicFile) {
                finalArgs.push('-i', bgMusicFile.path);
                finalArgs.push(
                    '-filter_complex', `[1:a]volume=${musicVolume},aloop=loop=-1:size=2e+09[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[a_final]`,
                    '-map', '0:v', '-map', '[a_final]'
                );
            } else {
                finalArgs.push('-c', 'copy');
            }
        } else {
            // --- XFADE COMPLEXO (TRANSIÇÕES) ---
            clipPaths.forEach(p => finalArgs.push('-i', p));
            
            let filter = "";
            let accumOffset = 0;
            const transDur = 1.0; 
            const transName = getTransitionXfade(transitionType);
            
            for (let i = 0; i < clipPaths.length - 1; i++) {
                const vSrc = (i === 0) ? `[0:v]` : `[v_tmp${i}]`;
                const aSrc = (i === 0) ? `[0:a]` : `[a_tmp${i}]`;
                const vNext = `[${i+1}:v]`;
                const aNext = `[${i+1}:a]`;
                
                accumOffset += videoClipDurations[i] - transDur;
                const safeOffset = Math.max(0, accumOffset);

                // Força o formato de pixel antes do xfade
                filter += `${vSrc}${vNext}xfade=transition=${transName}:duration=${transDur}:offset=${safeOffset.toFixed(3)}[v_tmp${i+1}];`;
                filter += `${aSrc}${aNext}acrossfade=d=${transDur}:c1=tri:c2=tri[a_tmp${i+1}];`;
            }
            
            const lastIdx = clipPaths.length - 1;
            const finalVLabel = `[v_tmp${lastIdx}]`;
            const finalALabel = `[a_tmp${lastIdx}]`;
            
            if (bgMusicFile) {
                finalArgs.push('-i', bgMusicFile.path);
                const bgmIdx = clipPaths.length; 
                filter += `[${bgmIdx}:a]volume=${musicVolume},aloop=loop=-1:size=2e+09[bgm];${finalALabel}[bgm]amix=inputs=2:duration=first:dropout_transition=0[a_final]`;
                
                const filterPath = path.join(uploadDir, `filter_${job.id}.txt`);
                fs.writeFileSync(filterPath, filter);
                finalArgs.push('-filter_complex_script', filterPath, '-map', finalVLabel, '-map', '[a_final]');
            } else {
                const filterPath = path.join(uploadDir, `filter_${job.id}.txt`);
                fs.writeFileSync(filterPath, filter);
                finalArgs.push('-filter_complex_script', filterPath, '-map', finalVLabel, '-map', finalALabel);
            }
        }

        if (transitionType !== 'cut' || bgMusicFile) {
             finalArgs.push('-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-b:a', '192k', '-shortest');
        }
        
        finalArgs.push(outputPath);
        
        const totalDuration = videoClipDurations.reduce((a,b) => a+b, 0);
        callback(job.id, finalArgs, totalDuration);

        // Cleanup
        setTimeout(() => {
            clipPaths.forEach(p => { if(fs.existsSync(p)) fs.unlinkSync(p); });
            const listPath = path.join(uploadDir, `list_${job.id}.txt`);
            const filterPath = path.join(uploadDir, `filter_${job.id}.txt`);
            if(fs.existsSync(listPath)) fs.unlinkSync(listPath);
            if(fs.existsSync(filterPath)) fs.unlinkSync(filterPath);
        }, 600000);

    } catch (e) {
        console.error("ERRO CRÍTICO NO EXPORT:", e);
        if (jobs[job.id]) { jobs[job.id].status = 'failed'; jobs[job.id].error = e.message; }
    }
}

// === NOVO PROXY GENÉRICO PARA APIs EXTERNAS (DefAPI, Runway, etc.) ===
app.post('/api/proxy', async (req, res) => {
    const { url, method, headers, body } = req.body;
    
    if (!url) return res.status(400).json({ error: "Missing 'url' parameter" });

    // Aumentado para 90s para dar margem à DefAPI (que pode ser lenta)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
        console.log(`[PROXY REQUEST] ${method || 'GET'} -> ${url}`);
        if(body) console.log(`[PROXY BODY] Preview:`, JSON.stringify(body).substring(0, 150));
        
        const response = await fetch(url, {
            method: method || 'GET',
            headers: headers || {},
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        console.log(`[PROXY RESPONSE] Status: ${response.status} ${response.statusText}`);

        // Tenta parsear JSON, senão retorna texto, mas loga se houver erro
        let data;
        const contentType = response.headers.get("content-type");
        const responseText = await response.text();

        try {
            if (contentType && contentType.indexOf("application/json") !== -1) {
                data = JSON.parse(responseText);
            } else {
                data = responseText;
            }
        } catch (e) {
            console.error("[PROXY PARSE ERROR]", e);
            data = responseText; // Retorna texto bruto se falhar o JSON
        }

        if (!response.ok) {
            console.error("[PROXY API ERROR BODY]:", responseText);
            // Retorna o corpo do erro da API original para o frontend tratar
            return res.status(response.status).json(typeof data === 'object' ? data : { error: data, message: response.statusText });
        }

        res.status(response.status).json(data);
    } catch (e) {
        console.error("[PROXY FETCH ERROR]", e);
        res.status(500).json({ error: e.message || "Proxy request failed/timed out", details: e.toString() });
    } finally {
        clearTimeout(timeoutId);
    }
});

app.post('/api/process/start/:action', uploadAny, (req, res) => {
    const action = req.params.action;
    const jobId = `${action}_${Date.now()}`;
    let ext = 'mp4';
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
        createFFmpegJob(jobId, args, 30, res);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
        jobs[jobId].status = 'failed';
    }
});

app.post('/api/edit/start/:action', uploadAny, (req, res) => {
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
