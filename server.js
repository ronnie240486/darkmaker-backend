
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
import https from 'https';

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

// --- INTERNAL PRESETS: ALL MOVEMENTS ---

function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const fps = 30; 
    const totalFrames = Math.ceil(d * fps);
    const zdur = `:d=${totalFrames}:s=${targetW}x${targetH}`;
    const t = `(on/${totalFrames})`; 

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
    // IMPORTANTE: pad=ceil(iw/2)*2:ceil(ih/2)*2 Garante dimensões pares para libx264
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

const hasAudioStream = (filePath) => {
    return new Promise((resolve) => {
        if (!fs.existsSync(filePath)) { resolve(false); return; }
        execFile(ffprobePath.path, [
            '-v', 'error', 
            '-select_streams', 'a', 
            '-show_entries', 'stream=codec_type', 
            '-of', 'csv=p=0', 
            filePath
        ], (err, stdout) => {
            resolve(!err && stdout.trim().length > 0);
        });
    });
};

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

function getToolCommand(action, inputFiles, params, outputPath) {
    const isAudioAction = ['clean-audio', 'pitch-shift', 'speed', 'bass-boost', 'reverb', 'normalize', '8d-audio', 'join'].includes(action);
    const isAudioFile = inputFiles[0]?.mimetype?.includes('audio');
    
    if (isAudioAction || (isAudioFile && action !== 'convert' && action !== 'join')) {
        return ['-i', inputFiles[0].path, '-c:a', 'libmp3lame', outputPath];
    }

    const input = inputFiles[0]?.path;
    const args = ['-i', input];

    switch (action) {
        case 'upscale': args.push('-vf', 'scale=1920:1080', ...getVideoArgs()); break;
        default: args.push('-c', 'copy');
    }
    args.push(outputPath);
    return args;
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

        for (let i = 0; i < sortedScenes.length; i++) {
            const scene = sortedScenes[i];
            const clipPath = path.join(uploadDir, `temp_${job.id}_${i}.mp4`);
            
            let dur = 5;
            if (scene.audio) {
                const audioDur = await getExactDuration(scene.audio.path);
                const PAUSE_AFTER_AUDIO = 0.3; 
                const TRANSITION_OVERLAP = 1.0; 
                dur = (audioDur > 0 ? audioDur : 5) + PAUSE_AFTER_AUDIO + TRANSITION_OVERLAP;
            }
            
            const args = [];
            let isVideoInput = false;
            let videoHasAudio = false;

            // Visual Input handling
            if (scene.visual?.mimetype?.includes('image')) {
                // Image: Loop it
                args.push('-framerate', '30', '-loop', '1', '-i', scene.visual.path);
            } else if (scene.visual) {
                // Video: No loop needed, it's a file
                args.push('-i', scene.visual.path);
                isVideoInput = true;
                videoHasAudio = await hasAudioStream(scene.visual.path);
            } else {
                // Fallback
                args.push('-f', 'lavfi', '-i', `color=c=black:s=${targetW}x${targetH}:d=${(dur + 2).toFixed(3)}`);
            }

            // Audio Inputs
            if (scene.audio) {
                args.push('-i', scene.audio.path);
            } else {
                args.push('-f', 'lavfi', '-i', `anullsrc=cl=stereo:sr=44100:d=${(dur + 2).toFixed(3)}`);
            }

            let hasSfx = false;
            if (scene.sfx) {
                args.push('-i', scene.sfx.path);
                hasSfx = true;
            }

            let filterComplex = "";
            let audioMap = "[a_out]";
            
            // --- Audio Mixing Logic (New) ---
            let mixInputs = [];
            
            // 1. Video Audio (Input 0)
            if (isVideoInput && videoHasAudio) {
                // Dim video audio slightly to prioritize voice
                filterComplex += `[0:a]volume=1.0[vid_a];`;
                mixInputs.push("[vid_a]");
            }

            // 2. Narration (Input 1)
            // Use apad so it plays along with longer videos if needed
            filterComplex += `[1:a]volume=1.5,apad[voice];`;
            mixInputs.push("[voice]");

            // 3. SFX (Input 2)
            if (hasSfx) {
                filterComplex += `[2:a]volume=${sfxVolume},apad[sfx];`;
                mixInputs.push("[sfx]");
            }

            // Combine
            if (mixInputs.length > 1) {
                // duration=longest ensures we keep video audio if video is longer than voice (cut by -t later)
                filterComplex += `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0,aresample=async=1[a_out];`;
            } else {
                filterComplex += `[voice]aresample=async=1[a_out];`;
            }

            // --- Video Processing ---
            if (!isVideoInput) {
                // Image: Apply movement filters (Zoom/Pan)
                const moveFilter = getMovementFilter(movement, dur, targetW, targetH);
                filterComplex += `[0:v]${moveFilter}[v_out]`;
            } else {
                // Video: Scale, Crop, Reset PTS
                // We ensure it scales to target resolution and resets timestamps for correct cuts
                filterComplex += `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},pad=ceil(iw/2)*2:ceil(ih/2)*2,setsar=1,fps=30,setpts=PTS-STARTPTS,format=yuv420p[v_out]`;
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
                p.on('close', c => c === 0 ? resolve() : reject(new Error(`Erro Render Cena ${i}`)));
            });
            
            const actualDur = await getExactDuration(clipPath);
            videoClipDurations.push(actualDur);
            clipPaths.push(clipPath);
            if(jobs[job.id]) jobs[job.id].progress = Math.round((i / sortedScenes.length) * 80);
        }

        let finalArgs = [];
        if (transitionType === 'cut' || clipPaths.length < 2) {
            const listPath = path.join(uploadDir, `list_${job.id}.txt`);
            const fileContent = clipPaths.map(p => `file '${path.resolve(p).replace(/\\/g, '/')}'`).join('\n');
            fs.writeFileSync(listPath, fileContent);
            finalArgs = ['-f', 'concat', '-safe', '0', '-i', listPath];
            if (bgMusicFile) {
                finalArgs.push('-i', bgMusicFile.path);
                finalArgs.push('-filter_complex', `[1:a]volume=${musicVolume},aloop=loop=-1:size=2e+09[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[a_final]`, '-map', '0:v', '-map', '[a_final]');
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
                accumOffset += videoClipDurations[i] - transDur;
                const safeOffset = Math.max(0, accumOffset).toFixed(3);
                filter += `${vSrc}[${i+1}:v]xfade=transition=${transName}:duration=${transDur}:offset=${safeOffset}[v_tmp${i+1}];`;
                filter += `${aSrc}[${i+1}:a]acrossfade=d=${transDur}:c1=tri:c2=tri[a_tmp${i+1}];`;
            }
            const lastIdx = clipPaths.length - 1;
            if (bgMusicFile) {
                finalArgs.push('-i', bgMusicFile.path);
                const bgmIdx = clipPaths.length; 
                filter += `[${bgmIdx}:a]volume=${musicVolume},aloop=loop=-1:size=2e+09[bgm];[a_tmp${lastIdx}][bgm]amix=inputs=2:duration=first:dropout_transition=0[a_final]`;
                finalArgs.push('-filter_complex', filter, '-map', `[v_tmp${lastIdx}]`, '-map', '[a_final]');
            } else {
                finalArgs.push('-filter_complex', filter, '-map', `[v_tmp${lastIdx}]`, '-map', `[a_tmp${lastIdx}]`);
            }
        }

        if (transitionType !== 'cut' || bgMusicFile) {
             finalArgs.push(...getVideoArgs(), ...getAudioArgs(), '-shortest');
        }
        finalArgs.push(outputPath);
        const totalDuration = videoClipDurations.reduce((a,b) => a+b, 0);
        callback(job.id, finalArgs, totalDuration);

        setTimeout(() => {
            clipPaths.forEach(p => { if(fs.existsSync(p)) fs.unlinkSync(p); });
            const listPath = path.join(uploadDir, `list_${job.id}.txt`);
            if(fs.existsSync(listPath)) fs.unlinkSync(listPath);
        }, 600000);
    } catch (e) {
        console.error("ERRO CRÍTICO NO EXPORT:", e);
        if (jobs[job.id]) { jobs[job.id].status = 'failed'; jobs[job.id].error = e.message; }
    }
}

// === ROUTES ===

app.post('/api/process/start/:action', uploadAny, (req, res) => {
    const action = req.params.action;
    const jobId = `${action}_${Date.now()}`;
    const outputName = `processed_${jobId}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    jobs[jobId] = { id: jobId, status: 'pending', progress: 0, files: req.files, params: req.body, downloadUrl: null };
    try {
        const args = getToolCommand(action, req.files, req.body, outputPath); 
        createFFmpegJob(jobId, args, 30, res);
    } catch (e) {
        res.status(500).json({ error: e.message });
        jobs[jobId].status = 'failed';
    }
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

app.post('/api/image/start/:action', uploadAny, (req, res) => {
    const jobId = `img_${Date.now()}`;
    const file = req.files[0];
    const outputPath = path.join(OUTPUT_DIR, `img_${jobId}${path.extname(file.originalname)}`);
    fs.copyFileSync(file.path, outputPath);
    jobs[jobId] = { id: jobId, status: 'completed', progress: 100, downloadUrl: `/outputs/${path.basename(outputPath)}` };
    res.json({ jobId });
});

// Endpoint de Proxy Robusto usando Fetch nativo (Node 18+)
app.post('/api/proxy', async (req, res) => {
    const { url, method, headers, body } = req.body;
    if (!url) return res.status(400).json({ error: "URL ausente" });

    console.log(`[PROXY] ${method || 'GET'} -> ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minutos de timeout global

    try {
        const response = await fetch(url, {
            method: method || 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (AI Media Suite)',
                ...headers
            },
            body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const contentType = response.headers.get('content-type');
        let data;
        
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
            res.status(response.status).json(data);
        } else {
            const text = await response.text();
            res.status(response.status).send(text);
        }
    } catch (e) {
        clearTimeout(timeoutId);
        console.error("[PROXY ERROR]", e.message);
        if (e.name === 'AbortError') {
            return res.status(504).json({ error: "Timeout: O servidor externo demorou muito para responder." });
        }
        res.status(500).json({ error: "Falha na conexão externa", details: e.message });
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Turbo Server Running on Port ${PORT}`));
