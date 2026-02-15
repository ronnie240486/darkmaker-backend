
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

// FFmpeg setup
const FFMPEG_BIN = typeof ffmpegPath === 'string' ? ffmpegPath : ffmpegPath.path;
const FFPROBE_BIN = typeof ffprobePath === 'string' ? ffprobePath : ffprobePath.path;

// Directories
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

[UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach(dir => {
    if (fs.existsSync(dir) && !fs.lstatSync(dir).isDirectory()) {
        fs.rmSync(dir, { force: true });
    }
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Helpers
async function fileHasAudio(file) {
    return new Promise(resolve => {
        execFile(FFPROBE_BIN, [
            "-v","error",
            "-select_streams","a",
            "-show_entries","stream=codec_type",
            "-of","csv=p=0",
            file
        ], (err, stdout) => {
            resolve(stdout && stdout.toString().trim().length > 0);
        });
    });
}

async function isVideoFile(file) {
    return new Promise(resolve => {
        execFile(FFPROBE_BIN, [
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=codec_type",
            "-of", "csv=p=0",
            file
        ], (err, stdout) => {
            const output = stdout ? stdout.toString().trim() : "";
            if (output.includes('video')) {
                execFile(FFPROBE_BIN, [
                    "-v", "error",
                    "-select_streams", "v:0",
                    "-show_entries", "stream=nb_frames",
                    "-of", "csv=p=0",
                    file
                ], (err2, stdout2) => {
                    const frames = parseInt(stdout2);
                    resolve(!isNaN(frames) && frames > 1);
                });
            } else {
                resolve(false);
            }
        });
    });
}

const saveBase64OrUrl = async (input, prefix, ext) => {
    if (!input) return null;
    const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);
    
    try {
        if (input.startsWith('data:')) {
            const commaIndex = input.indexOf(',');
            if (commaIndex === -1) return null;
            const base64Data = input.substring(commaIndex + 1);
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(filepath, buffer);
            return filename;
        } else if (input.startsWith('http')) {
            const res = await fetch(input);
            if (!res.ok) return null;
            const arrayBuffer = await res.arrayBuffer();
            fs.writeFileSync(filepath, Buffer.from(arrayBuffer));
            return filename;
        }
    } catch(e) { console.error(e); return null; }
    return null;
};

function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const w = parseInt(targetW) || 1280;
    const h = parseInt(targetH) || 720;
    const fps = 24;
    const zNorm = `(time/${d})`; 
    const zp = `zoompan=d=1:fps=${fps}:s=${w}x${h}`;
    const center = `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    const scaleFactor = 2.0; 

    const moves = {
        'static': `${zp}:z=1.0${center}`,
        'kenburns': `${zp}:z='1.0+(0.3*${zNorm})':x='(iw/2-(iw/zoom/2))*(1-0.2*${zNorm})':y='(ih/2-(ih/zoom/2))*(1-0.2*${zNorm})'`,
        'zoom-in': `${zp}:z='1.0+(0.6*${zNorm})'${center}`,
        'zoom-out': `${zp}:z='1.6-(0.6*${zNorm})'${center}`,
        'mov-pan-slow-l': `${zp}:z=1.4:x='(iw/2-(iw/zoom/2))*(1+0.5*${zNorm})'${center}`,
        'mov-pan-slow-r': `${zp}:z=1.4:x='(iw/2-(iw/zoom/2))*(1-0.5*${zNorm})'${center}`,
    };

    const selected = moves[moveId] || moves['kenburns'];
    const pre = `scale=${Math.ceil(w*scaleFactor)}:${Math.ceil(h*scaleFactor)}:force_original_aspect_ratio=increase,crop=${Math.ceil(w*scaleFactor)}:${Math.ceil(h*scaleFactor)},setsar=1`;
    const post = `scale=${w}:${h}:flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=${fps},format=yuv420p`;
    return `${pre},${selected},${post}`;
}

function getTransitionXfade(t) {
    const map = {
        'cut': 'fade', 'fade':'fade', 'mix':'dissolve', 'black':'fadeblack', 'white':'fadewhite',
        'slide-left':'slideleft', 'slide-right':'slideright',
        'wipe-left': 'wipeleft', 'wipe-right': 'wiperight', 'wipe-up': 'wipeup', 'wipe-down': 'wipedown',
        'circle-open': 'circleopen', 'circle-close': 'circleclose'
    };
    return map[t] || 'fade';
}

const getVideoArgs = () => ['-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart','-r','24'];
const getAudioArgs = () => ['-c:a','aac','-b:a','192k','-ar','44100','-ac','2'];

// --- BUILD FRONTEND ---
async function buildFrontend() {
    try {
        const copySafe = (src, dest) => {
            if (fs.existsSync(src)) {
                const destDir = path.dirname(dest);
                if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                fs.copyFileSync(src, dest);
            }
        };
        copySafe('index.html', path.join(PUBLIC_DIR,'index.html'));
        copySafe('index.css', path.join(PUBLIC_DIR,'index.css'));
        await esbuild.build({
            entryPoints:['index.tsx'],
            outfile:path.join(PUBLIC_DIR,'bundle.js'),
            bundle:true,
            format:'esm',
            minify:true,
            external: ['fs', 'path', 'child_process', 'url', 'https', 'ffmpeg-static', 'ffprobe-static'],
            define: { 'process.env.API_KEY': JSON.stringify(GEMINI_KEY), 'global': 'window' },
            loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
        });
    } catch(e) { console.error("Frontend error:", e); }
}
await buildFrontend();

// ==============================
//  SERVER ROUTES & ENGINE
// ==============================
app.use(cors());
app.use(express.json({limit:'900mb'}));
app.use(express.urlencoded({extended:true, limit:'900mb'}));
app.use(express.static(PUBLIC_DIR));
app.use('/outputs', express.static(OUTPUT_DIR));

const storage = multer.diskStorage({
    destination:(req,file,cb)=>cb(null,UPLOAD_DIR),
    filename:(req,file,cb)=>cb(null, Date.now()+"-"+file.originalname.replace(/[^a-zA-Z0-9_.-]/g,"_"))
});
const uploadAny = multer({storage}).any();
const jobs = {};

function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const ff = spawn(FFMPEG_BIN, args);
        let errData = "";
        ff.stderr.on('data', d => errData += d.toString());
        ff.on("close", code => {
            if (code === 0) resolve();
            else reject(`FFmpeg error ${code}: ${errData.slice(-500)}`);
        });
    });
}

async function renderVideoProject(project, jobId) {
    const sessionDir = path.join(OUTPUT_DIR, `job_${jobId}`);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    if (!project.clips || project.clips.length === 0) throw new Error("Nenhum clipe para renderizar.");

    const tempClips = [];
    const durations = [];
    let targetW = 1280;
    let targetH = 720;
    if (project.aspectRatio === '9:16') { targetW = 720; targetH = 1280; }

    const voiceVol = project.audio.voiceVolume ?? 1.0;
    const sfxVol = project.audio.sfxVolume ?? 0.5;
    const AUDIO_SPEC = "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo";

    for (let i = 0; i < project.clips.length; i++) {
        const clip = project.clips[i];
        const inputPath = path.join(UPLOAD_DIR, clip.file);
        let duration = parseFloat(clip.duration || 5);
        if (duration <= 0) duration = 5;
        durations.push(duration);

        const outFile = path.join(sessionDir, `clip_${i}.mp4`);
        tempClips.push(outFile);

        const isVideo = clip.mediaType === 'video' || await isVideoFile(inputPath);
        const args = ["-y"];

        if (isVideo) args.push("-stream_loop", "-1", "-i", inputPath);
        else args.push("-loop", "1", "-framerate", "24", "-i", inputPath);

        let inputIndex = 1;
        let audioMixLabels = [];
        let filterComplex = "";

        if (clip.audio) {
            const aPath = path.join(UPLOAD_DIR, clip.audio);
            if (fs.existsSync(aPath)) {
                args.push("-i", aPath);
                filterComplex += `[${inputIndex}:a]${AUDIO_SPEC},volume=${voiceVol}[voice${i}];`;
                audioMixLabels.push(`[voice${i}]`);
                inputIndex++;
            }
        } else if (isVideo && await fileHasAudio(inputPath)) {
             filterComplex += `[0:a]${AUDIO_SPEC},volume=${voiceVol}[voice${i}];`;
             audioMixLabels.push(`[voice${i}]`);
        }

        if (clip.sfx) {
            const sfxPath = path.join(UPLOAD_DIR, clip.sfx);
            if (fs.existsSync(sfxPath)) {
                args.push("-i", sfxPath);
                filterComplex += `[${inputIndex}:a]${AUDIO_SPEC},volume=${sfxVol}[sfx${i}];`;
                audioMixLabels.push(`[sfx${i}]`);
                inputIndex++;
            }
        }

        const moveF = getMovementFilter(clip.movement || "kenburns", duration, targetW, targetH);
        filterComplex += `[0:v]${moveF}[v_out];`;

        if (audioMixLabels.length > 0) {
            if (audioMixLabels.length > 1) {
                filterComplex += `${audioMixLabels.join('')}amix=inputs=${audioMixLabels.length}:duration=longest:dropout_transition=1[a_mix];`;
                filterComplex += `[a_mix]atrim=0:${duration},asetpts=PTS-STARTPTS,apad,${AUDIO_SPEC}[a_out]`;
            } else {
                filterComplex += `${audioMixLabels[0]}atrim=0:${duration},asetpts=PTS-STARTPTS,apad,${AUDIO_SPEC}[a_out]`;
            }
        } else {
            // Fix: 'd' option is not valid for anullsrc on many FFmpeg versions. Use atrim instead.
            filterComplex += `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${duration},asetpts=PTS-STARTPTS,${AUDIO_SPEC}[a_out]`;
        }

        args.push("-filter_complex", filterComplex, "-map", "[v_out]", "-map", "[a_out]", "-t", duration.toString(), ...getVideoArgs(), ...getAudioArgs(), outFile);

        await runFFmpeg(args);
        jobs[jobId].progress = Math.floor((i / project.clips.length) * 45);
    }

    const concatOut = path.join(sessionDir, "video_final.mp4");
    const trType = getTransitionXfade(project.transition || "fade");

    if (tempClips.length === 1) {
        fs.copyFileSync(tempClips[0], concatOut);
    } else {
        const inputArgs = [];
        tempClips.forEach(p => inputArgs.push("-i", p));
        
        const minDur = Math.min(...durations);
        let trDur = 0.5;
        if (trDur > minDur * 0.4) trDur = minDur * 0.4; 

        let filterGraph = "";
        let prevLabelV = "[0:v]";
        let prevLabelA = "[0:a]";
        let timeCursor = durations[0];

        for (let i = 1; i < tempClips.length; i++) {
            const offset = (timeCursor - trDur).toFixed(3); 
            filterGraph += `${prevLabelV}[${i}:v]xfade=transition=${trType}:duration=${trDur}:offset=${offset}[v_tmp${i}];`;
            filterGraph += `${prevLabelA}[${i}:a]acrossfade=d=${trDur}:c1=tri:c2=tri,${AUDIO_SPEC}[a_tmp${i}];`;
            prevLabelV = `[v_tmp${i}]`;
            prevLabelA = `[a_tmp${i}]`;
            timeCursor += (durations[i] - trDur);
        }
        
        await runFFmpeg(["-y", ...inputArgs, "-filter_complex", filterGraph, "-map", prevLabelV, "-map", prevLabelA, ...getVideoArgs(), ...getAudioArgs(), concatOut]);
    }

    const bgm = project.audio?.bgm ? path.join(UPLOAD_DIR, project.audio.bgm) : null;
    let finalOutput = path.join(OUTPUT_DIR, `video_${jobId}.mp4`);

    if (bgm && fs.existsSync(bgm)) {
        const mixGraph = `[1:a]aloop=loop=-1:size=2e+09,${AUDIO_SPEC},volume=${project.audio.bgmVolume ?? 0.2}[bgm_n];[0:a][bgm_n]amix=inputs=2:duration=first:dropout_transition=1,${AUDIO_SPEC}[a_final]`;
        await runFFmpeg(["-y", "-i", concatOut, "-i", bgm, "-filter_complex", mixGraph, "-map", "0:v", "-map", "[a_final]", ...getVideoArgs(), ...getAudioArgs(), finalOutput]);
    } else {
        fs.copyFileSync(concatOut, finalOutput);
    }

    jobs[jobId].progress = 100;
    return finalOutput;
}

app.post("/api/process/start/:action", (req, res) => {
    uploadAny(req, res, async (err) => {
        if (err) return res.status(500).json({ error: err.message });
        const jobId = Date.now().toString();
        jobs[jobId] = { progress: 0, status: "processing" };
        res.json({ jobId });
    });
});

app.post("/api/render/start", async (req, res) => {
    const jobId = Date.now().toString();
    jobs[jobId] = { progress: 1, status: "processing" };
    try {
        const { scenes, config, bgmUrl } = req.body;
        const project = {
            clips: [],
            audio: { bgm: null, bgmVolume: config.musicVolume || 0.2, sfxVolume: config.sfxVolume || 0.5, voiceVolume: config.voiceVolume || 1.0 },
            transition: config.transition || 'fade', 
            aspectRatio: config.aspectRatio || '16:9'
        };
        if (bgmUrl) project.audio.bgm = await saveBase64OrUrl(bgmUrl, 'bgm', 'mp3');
        for (let i = 0; i < scenes.length; i++) {
            const s = scenes[i];
            const visualFile = s.videoUrl ? await saveBase64OrUrl(s.videoUrl, `s_${i}_v`, 'mp4') : await saveBase64OrUrl(s.imageUrl, `s_${i}_i`, 'png');
            if (visualFile) {
                project.clips.push({
                    file: visualFile,
                    audio: s.audioUrl ? await saveBase64OrUrl(s.audioUrl, `s_${i}_a`, 'wav') : null,
                    sfx: s.sfxUrl ? await saveBase64OrUrl(s.sfxUrl, `s_${i}_s`, 'mp3') : null,
                    duration: parseFloat(s.duration || 5),
                    movement: s.effect || config.movement || 'kenburns',
                    mediaType: s.mediaType 
                });
            }
        }
        renderVideoProject(project, jobId).then(out => {
            jobs[jobId].status = "completed"; jobs[jobId].downloadUrl = `/outputs/${path.basename(out)}`;
        }).catch(err => { 
            console.error(err);
            jobs[jobId].status = "failed"; jobs[jobId].error = err.toString(); 
        });
        res.json({ jobId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/proxy", async (req, res) => {
    const { url, method, headers, body } = req.body;
    try {
        const response = await fetch(url, { method: method || 'GET', headers: headers || { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        const data = await (response.headers.get("content-type")?.includes("application/json") ? response.json() : response.text());
        res.status(response.status).json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/process/status/:id", (req, res) => {
    const job = jobs[req.params.id];
    if (!job) return res.status(404).json({ status: "not_found" });
    res.json(job);
});

app.get("/api/download/:file", (req, res) => {
    const filePath = path.join(OUTPUT_DIR, req.params.file);
    if (!fs.existsSync(filePath)) return res.status(404).send("File not found");
    res.download(filePath);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Running on Port ${PORT}`);
});
