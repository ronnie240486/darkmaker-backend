
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

// --- INTERNAL PRESETS: ALL MOVEMENTS (MATCHING FRONTEND) ---

function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const fps = 30; 
    const totalFrames = Math.ceil(d * fps);
    const zdur = `:d=${totalFrames}:s=${targetW}x${targetH}`;
    const t = `(on/${totalFrames})`; 

    // --- DICIONÁRIO COMPLETO DE MOVIMENTOS (TODOS DO FRONTEND) ---
    const moves = {
        // === Estático & Suave ===
        'static': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'kenburns': `zoompan=z='1.0+(0.3*${t})':x='(iw/2-(iw/zoom/2))*(1-0.2*${t})':y='(ih/2-(ih/zoom/2))*(1-0.2*${t})'${zdur}`,
        'mov-3d-float': `zoompan=z='1.05+0.03*sin(on/30)':x='iw/2-(iw/zoom/2)+10*sin(on/50)':y='ih/2-(ih/zoom/2)+10*cos(on/60)'${zdur}`,
        'mov-tilt-up-slow': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))+(ih/5*${t})'${zdur}`,
        'mov-tilt-down-slow': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))-(ih/5*${t})'${zdur}`,

        // === Zoom Dinâmico ===
        'zoom-in': `zoompan=z='1.0+(0.5*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'zoom-out': `zoompan=z='1.5-(0.5*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-crash-in': `zoompan=z='1.0+4*${t}*${t}*${t}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-crash-out': `zoompan=z='5-4*${t}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-bounce-in': `zoompan=z='if(lt(${t},0.8), 1.0+0.5*${t}, 1.5-0.1*sin((${t}-0.8)*20))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-pulse-slow': `zoompan=z='1.1+0.15*sin(on/20)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-dolly-vertigo': `zoompan=z='1.0+(0.8*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-twist-in': `rotate=angle='(PI/10)*${t}':fillcolor=black,zoompan=z='1.0+(0.6*${t})'${zdur}`,
        'mov-zoom-wobble': `zoompan=z='1.1':x='iw/2-(iw/zoom/2)+20*sin(on/15)':y='ih/2-(ih/zoom/2)+20*cos(on/15)'${zdur}`,
        'mov-scale-pulse': `zoompan=z='1.0+0.2*sin(on/10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,

        // === Panorâmicas ===
        'mov-pan-slow-l': `zoompan=z=1.3:x='(iw/2-(iw/zoom/2))+(iw/4*${t})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-r': `zoompan=z=1.3:x='(iw/2-(iw/zoom/2))-(iw/4*${t})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-u': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))+(ih/4*${t})'${zdur}`,
        'mov-pan-slow-d': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))-(ih/4*${t})'${zdur}`,
        'mov-pan-fast-l': `zoompan=z=1.3:x='(iw/2-(iw/zoom/2))+(iw/2*${t})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-fast-r': `zoompan=z=1.3:x='(iw/2-(iw/zoom/2))-(iw/2*${t})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-diag-tl': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))+(iw/5*${t})':y='(ih/2-(ih/zoom/2))+(ih/5*${t})'${zdur}`,
        'mov-pan-diag-br': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))-(iw/5*${t})':y='(ih/2-(ih/zoom/2))-(ih/5*${t})'${zdur}`,

        // === Câmera na Mão & Realismo ===
        'handheld-1': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+10*sin(on/10)':y='ih/2-(ih/zoom/2)+10*cos(on/15)'${zdur}`,
        'handheld-2': `zoompan=z=1.15:x='iw/2-(iw/zoom/2)+25*sin(on/5)':y='ih/2-(ih/zoom/2)+25*cos(on/7)'${zdur}`,
        'earthquake': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+50*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+50*(random(1)-0.5)'${zdur}`,
        'mov-jitter-x': `zoompan=z=1.05:x='iw/2-(iw/zoom/2)+15*sin(on*10)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-walk': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+15*sin(on/15)':y='ih/2-(ih/zoom/2)+10*abs(sin(on/7))'${zdur}`,

        // === 3D & Rotação ===
        'mov-3d-spin-axis': `rotate=angle='2*PI*${t}':fillcolor=black,zoompan=z=1.3${zdur}`,
        'mov-3d-flip-x': `zoompan=z='1+0.2*sin(on/10)'${zdur}`,
        'mov-3d-flip-y': `zoompan=z='1+0.2*cos(on/10)'${zdur}`,
        'mov-3d-swing-l': `rotate=angle='(PI/12)*sin(on/30)':fillcolor=black,zoompan=z=1.2${zdur}`,
        'mov-3d-roll': `rotate=angle='2*PI*${t}':fillcolor=black,zoompan=z=1.6${zdur}`,

        // === Glitch & Caos ===
        'mov-glitch-snap': `zoompan=z='if(mod(on,24)<2, 1.3, 1.0)':x='iw/2-(iw/zoom/2)+if(mod(on,24)<2, 50, 0)':y='ih/2-(ih/zoom/2)'${zdur},noise=alls=20:allf=t`,
        'mov-glitch-skid': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)+if(mod(on,12)<3, 100, 0)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-shake-violent': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+80*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+80*(random(1)-0.5)'${zdur}`,
        'mov-rgb-shift-move': `rgbashift=rh=15:bv=15,zoompan=z=1.05${zdur}`,
        'mov-vibrate': `zoompan=z=1.02:x='iw/2-(iw/zoom/2)+5*sin(on*100)':y='ih/2-(ih/zoom/2)+5*cos(on*100)'${zdur}`,

        // === Foco & Blur ===
        'mov-blur-in': `boxblur=luma_radius='20*(1-${t})':enable='between(t,0,${d})',zoompan=z=1${zdur}`,
        'mov-blur-out': `boxblur=luma_radius='20*${t}':enable='between(t,0,${d})',zoompan=z=1${zdur}`,
        'mov-blur-pulse': `boxblur=luma_radius='15*abs(sin(on/15))',zoompan=z=1${zdur}`,
        'mov-tilt-shift': `boxblur=luma_radius=10:enable='if(between(y,0,h*0.25)+between(y,h*0.75,h),1,0)',zoompan=z=1${zdur}`,

        // === Elástico & Divertido ===
        'mov-rubber-band': `zoompan=z='1.0+0.3*abs(sin(on/15))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-jelly-wobble': `zoompan=z='1.05+0.05*sin(on/8)':x='iw/2-(iw/zoom/2)+15*sin(on/6)':y='ih/2-(ih/zoom/2)+15*cos(on/6)'${zdur}`,
        'mov-pop-up': `zoompan=z='min(1.0 + ${t}*10, 1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-bounce-drop': `zoompan=z='1.0':y='(ih/2-(ih/zoom/2)) + (ih/3 * abs(cos(${t}*4*PI)) * (1-${t}))'${zdur}`
    };

    const selectedFilter = moves[moveId] || moves['kenburns'];
    
    // CRÍTICO: pad=ceil(iw/2)*2:ceil(ih/2)*2 força dimensões pares
    const pre = `scale=${targetW*2}:${targetH*2}:force_original_aspect_ratio=increase,crop=${targetW*2}:${targetH*2},setsar=1`;
    const post = `scale=${targetW}:${targetH}:flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=${fps},format=yuv420p`;
    
    return `${pre},${selectedFilter},${post}`;
}

function getTransitionXfade(transId) {
    const id = transId?.toLowerCase() || 'fade';
    const map = {
        'cut': 'fade', 'fade': 'fade', 'mix': 'dissolve', 'black': 'fadeblack', 'white': 'fadewhite',
        'slide-left': 'slideleft', 'slide-right': 'slideright', 'slide-up': 'slideup', 'slide-down': 'slidedown',
        'wipe-left': 'wipeleft', 'wipe-right': 'wiperight', 'circle-open': 'circleopen', 'pixelize': 'pixelize',
        'push-left': 'pushleft', 'push-right': 'pushright', 'whip-left': 'slideleft', 'whip-right': 'slideright',
        'blur-warp': 'hblur', 'glitch': 'pixelize', 'clock-wipe': 'radial', 'checker-wipe': 'checkerboard',
        'spiral-wipe': 'spiral', 'triangle-wipe': 'diagdist', 'flash-bang': 'fadewhite'
    };
    return map[id] || 'fade';
}

// CONFIGURAÇÃO FFmpeg
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
    } catch (e) { 
        console.error("Build Warning:", e.message); 
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

// --- FERRAMENTAS DE ÁUDIO E VÍDEO (TOOLS) ---

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
            const colorFilter = 'eq=saturation=1.1'; 
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
        const finalPath = args[args.length - 1];
        
        if (code === 0 && fs.existsSync(finalPath) && fs.statSync(finalPath).size > 1000) {
            jobs[jobId].status = 'completed';
            jobs[jobId].progress = 100;
            jobs[jobId].downloadUrl = `/outputs/${path.basename(finalPath)}`;
        } else {
            console.error(`[JOB ${jobId}] Failed. Code: ${code}`);
            console.error(`[JOB ${jobId}] Log Tail:`, stderrLog.slice(-500));
            jobs[jobId].status = 'failed';
            jobs[jobId].error = `Render Error (Code ${code}). Verifique logs.`;
        }
    });
}

function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return (parseFloat(parts[0]) * 3600) + (parseFloat(parts[1]) * 60) + parseFloat(parts[2]);
}

// === ENGINE DE EXPORTAÇÃO TURBO V2 (ATUALIZADA) ===
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
    let musicVolume = (jobConfig?.musicVolume !== undefined) ? parseFloat(jobConfig.musicVolume) : 0.2;
    let sfxVolume = (jobConfig?.sfxVolume !== undefined) ? parseFloat(jobConfig.sfxVolume) : 0.5;

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
            
            let dur = 5;
            // Calcular duração baseada no áudio se existir
            if (scene.audio) {
                const audioDur = await getExactDuration(scene.audio.path);
                
                // CORREÇÃO FINAL:
                // Pausa de 0.3s (menos de meio segundo) APÓS o término do áudio.
                // 1.0s de buffer para a transição.
                // A cena seguinte sobrepõe 1.0s, então o "início" visual e auditivo da próxima
                // ocorrerá exatos 0.3s depois que a voz atual terminar.
                const PAUSE_AFTER_AUDIO = 0.3; 
                const TRANSITION_OVERLAP = 1.0; 
                
                dur = (audioDur > 0 ? audioDur : 5) + PAUSE_AFTER_AUDIO + TRANSITION_OVERLAP;
            }
            
            const args = [];
            
            // 1. Input Visual
            if (scene.visual?.mimetype?.includes('image')) {
                args.push('-loop', '1', '-t', (dur + 2).toFixed(3), '-i', scene.visual.path);
            } else if (scene.visual) {
                args.push('-stream_loop', '-1', '-t', (dur + 2).toFixed(3), '-i', scene.visual.path);
            } else {
                args.push('-f', 'lavfi', '-i', `color=c=black:s=${targetW}x${targetH}:d=${(dur + 2).toFixed(3)}`);
            }

            // 2. Input Áudio (Voz)
            if (scene.audio) {
                args.push('-i', scene.audio.path);
            } else {
                args.push('-f', 'lavfi', '-i', `anullsrc=cl=stereo:sr=44100:d=${(dur + 2).toFixed(3)}`);
            }

            // 3. Input SFX
            let hasSfx = false;
            if (scene.sfx) {
                args.push('-i', scene.sfx.path);
                hasSfx = true;
            }

            let filterComplex = "";
            let audioMap = "[a_out]";
            
            // IMPORTANTE: 'apad' preenche com silêncio até atingir 'dur' (que calculamos acima)
            if (hasSfx) {
                filterComplex += `[1:a]volume=1.5,apad[voice];[2:a]volume=${sfxVolume},apad[sfx];[voice][sfx]amix=inputs=2:duration=longest:dropout_transition=0,aresample=async=1[a_out];`;
            } else {
                filterComplex += `[1:a]volume=1.5,apad,aresample=async=1[a_out];`;
            }

            // Visual Movement
            const moveFilter = getMovementFilter(movement, dur, targetW, targetH);
            filterComplex += `[0:v]${moveFilter}[v_out]`;

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
                p.on('close', c => c === 0 ? resolve() : reject(new Error(`Erro Render Cena ${i}`)));
            });
            
            if (!fs.existsSync(clipPath) || fs.statSync(clipPath).size < 1000) {
                throw new Error(`Falha crítica: Clipe ${i} vazio.`);
            }

            const actualDur = await getExactDuration(clipPath);
            videoClipDurations.push(actualDur);
            clipPaths.push(clipPath);
            
            if(jobs[job.id]) jobs[job.id].progress = Math.round((i / sortedScenes.length) * 80);
        }

        // PASSO 2: CONCATENAÇÃO
        let finalArgs = [];
        
        if (transitionType === 'cut' || clipPaths.length < 2) {
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
                
                // O offset é onde a transição começa.
                // Offset = (Onde termina o clipe anterior) - (Duração da Transição)
                accumOffset += videoClipDurations[i] - transDur;
                
                const safeOffset = Math.max(0, accumOffset).toFixed(3);
                
                filter += `${vSrc}${vNext}xfade=transition=${transName}:duration=${transDur}:offset=${safeOffset}[v_tmp${i+1}];`;
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

        // Re-encoding for final consistency
        if (transitionType !== 'cut' || bgMusicFile) {
             finalArgs.push(
                 ...getVideoArgs(),
                 ...getAudioArgs(),
                 '-shortest'
             );
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

// === ROUTES ===

app.post('/api/proxy', async (req, res) => {
    const { url, method, headers, body } = req.body;
    if (!url) return res.status(400).json({ error: "Missing 'url' parameter" });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    try {
        const response = await fetch(url, {
            method: method || 'GET',
            headers: headers || {},
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const responseText = await response.text();
        let data;
        try { data = JSON.parse(responseText); } catch (e) { data = { raw_response: responseText }; }
        if (!response.ok) return res.status(response.status).json(data);
        res.status(response.status).json(data);
    } catch (e) {
        res.status(500).json({ error: e.message || "Proxy request failed" });
    } finally { clearTimeout(timeoutId); }
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
