
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

// Setup Directories
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

[UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- INTERNAL PRESETS (Self-Contained to avoid import errors) ---

function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const fps = 24; 
    const totalFrames = Math.ceil(d * fps);
    const zdur = `:d=${totalFrames}:s=${targetW}x${targetH}`;
    const t = `(on/${totalFrames})`; 

    // Mapeamento de movimentos
    const moves = {
        'static': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'kenburns': `zoompan=z='1.0+(0.3*${t})':x='(iw/2-(iw/zoom/2))*(1-0.2*${t})':y='(ih/2-(ih/zoom/2))*(1-0.2*${t})'${zdur}`,
        'zoom-in': `zoompan=z='1.0+(0.5*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'zoom-out': `zoompan=z='1.5-(0.5*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-l': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1+0.5*${t})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-r': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1-0.5*${t})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'handheld-1': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+10*sin(on/10)':y='ih/2-(ih/zoom/2)+10*cos(on/15)'${zdur}`,
        'mov-shake-violent': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+60*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+60*(random(1)-0.5)'${zdur}`,
        'mov-blur-in': `boxblur=luma_radius='20*(1-${t})':enable='between(t,0,${d})',zoompan=z=1${zdur}`
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
        'wipe-left': 'wipeleft', 'wipe-right': 'wiperight', 'wipe-up': 'wipeup', 'wipe-down': 'wipedown',
        'push-left': 'pushleft', 'push-right': 'pushright',
        'burn': 'fadewhite', 'queimadura de filme': 'fadewhite'
    };
    return map[id] || 'fade';
}

// --- FFmpeg Configuration ---

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
    '-ar', '44100',
    '-ac', '2' // Force Stereo
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

// --- Build Frontend ---
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
    } catch (e) { console.error("Frontend Build Error:", e); }
}
await buildFrontend();

// --- Server Setup ---
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
    
    console.log(`[JOB ${jobId}] Executing FFmpeg...`);
    const ffmpeg = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-stats', '-y', ...args]);
    
    ffmpeg.stderr.on('data', d => {
        const line = d.toString();
        if(line.includes('Error') || line.includes('Invalid')) console.error(`[FFMPEG ERROR] ${line}`);
        
        if(line.includes('time=')) {
             const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
             if (timeMatch && expectedDuration > 0) {
                const parts = timeMatch[1].split(':');
                const cur = (parseFloat(parts[0]) * 3600) + (parseFloat(parts[1]) * 60) + parseFloat(parts[2]);
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
            console.error(`[JOB ${jobId}] Failed with code ${code} or empty file.`);
            jobs[jobId].status = 'failed';
            jobs[jobId].error = 'Renderização falhou. Verifique os inputs.';
        }
    });
}

// === EXPORT ENGINE ===
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
    const sceneData = jobConfig.sceneData || [];

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
        const transDur = 1.0; 

        // Renderizar Cenas
        for (let i = 0; i < sortedScenes.length; i++) {
            const scene = sortedScenes[i];
            const clipPath = path.join(uploadDir, `temp_${job.id}_${i}.mp4`);
            
            // Prioritize explicit duration passed from frontend
            let dur = 5;
            const metaDur = sceneData[i] && parseFloat(sceneData[i].duration);
            
            if (metaDur && !isNaN(metaDur) && metaDur > 0) {
                dur = metaDur;
            } else if (scene.audio) {
                dur = (await getExactDuration(scene.audio.path)) || 5;
            } else if (scene.visual && scene.visual.mimetype.includes('video')) {
                dur = (await getExactDuration(scene.visual.path)) || 5;
            }
            
            if (dur < transDur + 0.1) dur = transDur + 0.1; 
            
            const args = [];
            
            // Visual
            if (scene.visual?.mimetype?.includes('image')) {
                args.push('-framerate', '24', '-loop', '1', '-i', scene.visual.path);
            } else if (scene.visual) {
                args.push('-stream_loop', '-1', '-i', scene.visual.path);
            } else {
                args.push('-f', 'lavfi', '-i', `color=c=black:s=${targetW}x${targetH}:d=${dur}`);
            }

            // Audio Inputs
            if (scene.audio) {
                args.push('-i', scene.audio.path);
            } else {
                args.push('-f', 'lavfi', '-i', `anullsrc=cl=stereo:sr=44100:d=${dur}`);
            }

            let hasSfx = false;
            if (scene.sfx) {
                args.push('-i', scene.sfx.path);
                hasSfx = true;
            }

            let filterComplex = "";
            let audioMap = "[a_out]";
            
            if (hasSfx) {
                filterComplex += `[1:a]volume=1.5[voice];[2:a]volume=${sfxVolume}[sfx];[voice][sfx]amix=inputs=2:duration=first:dropout_transition=0[a_out];`;
            } else {
                filterComplex += `[1:a]volume=1.5[a_out];`;
            }

            const moveFilter = getMovementFilter(movement, dur, targetW, targetH);
            
            if (scene.visual?.mimetype?.includes('image')) {
                filterComplex += `[0:v]${moveFilter},setpts=PTS-STARTPTS[v_out]`;
            } else {
                filterComplex += `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},pad=ceil(iw/2)*2:ceil(ih/2)*2,setsar=1,fps=24,format=yuv420p,setpts=PTS-STARTPTS[v_out]`;
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
                p.on('close', c => c === 0 ? resolve() : reject(new Error(`Erro render cena ${i}`)));
            });
            
            if (!fs.existsSync(clipPath) || fs.statSync(clipPath).size < 1000) {
                throw new Error(`Falha crítica: Clipe ${i} gerado vazio.`);
            }

            const actualDur = await getExactDuration(clipPath);
            videoClipDurations.push(actualDur);
            clipPaths.push(clipPath);
            
            if(jobs[job.id]) jobs[job.id].progress = Math.round((i / sortedScenes.length) * 80);
        }

        // Concatenação
        let finalArgs = [];
        
        if (transitionType === 'cut' || clipPaths.length < 2) {
            const listPath = path.join(uploadDir, `list_${job.id}.txt`);
            const fileContent = clipPaths.map(p => `file '${path.resolve(p).replace(/\\/g, '/')}'`).join('\n');
            fs.writeFileSync(listPath, fileContent);
            finalArgs = ['-f', 'concat', '-safe', '0', '-i', listPath];
            if (bgMusicFile) {
                finalArgs.push('-i', bgMusicFile.path, '-filter_complex', `[1:a]volume=${musicVolume},aloop=loop=-1:size=2e+09[bgm];[0:a][bgm]amix=inputs=2:duration=first[a_final]`, '-map', '0:v', '-map', '[a_final]');
            } else {
                // Ensure we re-encode instead of copy to fix timestamp/audio mapping issues
                // finalArgs.push('-c', 'copy'); // REMOVED CAUSES NO AUDIO
            }
            // Always encode output
            finalArgs.push(...getVideoArgs(), ...getAudioArgs());
        } else {
            clipPaths.forEach(p => finalArgs.push('-i', p));
            let filter = "";
            let accumOffset = 0;
            const transName = getTransitionXfade(transitionType);
            
            for (let i = 0; i < clipPaths.length - 1; i++) {
                const vSrc = (i === 0) ? `[0:v]` : `[v_tmp${i}]`;
                const aSrc = (i === 0) ? `[0:a]` : `[a_tmp${i}]`;
                const vNext = `[${i+1}:v]`;
                const aNext = `[${i+1}:a]`;
                
                if (i === 0) accumOffset = videoClipDurations[0] - transDur;
                else accumOffset += (videoClipDurations[i] - transDur);
                
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
                filter += `[${bgmIdx}:a]volume=${musicVolume},aloop=loop=-1:size=2e+09[bgm];${finalALabel}[bgm]amix=inputs=2:duration=first[a_final]`;
                finalArgs.push('-filter_complex', filter, '-map', finalVLabel, '-map', '[a_final]');
            } else {
                finalArgs.push('-filter_complex', filter, '-map', finalVLabel, '-map', finalALabel);
            }
            finalArgs.push(...getVideoArgs(), ...getAudioArgs());
        }
        
        finalArgs.push(outputPath);
        const totalDuration = videoClipDurations.reduce((a,b) => a+b, 0);
        callback(job.id, finalArgs, totalDuration);

        // Cleanup
        setTimeout(() => {
            clipPaths.forEach(p => { if(fs.existsSync(p)) fs.unlinkSync(p); });
            const listPath = path.join(uploadDir, `list_${job.id}.txt`);
            if(fs.existsSync(listPath)) fs.unlinkSync(listPath);
        }, 300000);

    } catch (e) {
        console.error("ERRO CRÍTICO EXPORT:", e);
        if (jobs[job.id]) { jobs[job.id].status = 'failed'; jobs[job.id].error = e.message; }
    }
}

// === ROUTES ===

app.post('/api/process/start/:action', uploadAny, (req, res) => {
    const action = req.params.action;
    const jobId = `${action}_${Date.now()}`;
    const outputPath = path.join(OUTPUT_DIR, `processed_${jobId}.mp4`);
    jobs[jobId] = { id: jobId, status: 'completed', progress: 100, downloadUrl: `/outputs/sample.mp4` };
    res.json({ jobId });
});

app.post('/api/image/start/:action', uploadAny, (req, res) => {
    const jobId = `img_${Date.now()}`;
    const file = req.files[0];
    const outputPath = path.join(OUTPUT_DIR, `img_${jobId}${path.extname(file.originalname)}`);
    fs.copyFileSync(file.path, outputPath);
    jobs[jobId] = { id: jobId, status: 'completed', progress: 100, downloadUrl: `/outputs/${path.basename(outputPath)}` };
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

app.listen(PORT, '0.0.0.0', () => console.log(`Turbo Server Running on Port ${PORT}`));
