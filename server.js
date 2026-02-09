
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

// ==============================
//      DIR SETUP
// ==============================
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

[UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach(dir => {
    if (fs.existsSync(dir) && !fs.lstatSync(dir).isDirectory()) {
        fs.rmSync(dir, { force: true });
    }
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ==============================
//      FILE CHECKS & HELPERS
// ==============================
async function fileHasAudio(file) {
    return new Promise(resolve => {
        execFile(ffprobePath.path, [
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
        execFile(ffprobePath.path, [
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=codec_type",
            "-of", "csv=p=0",
            file
        ], (err, stdout) => {
            resolve(stdout && stdout.toString().trim().includes('video'));
        });
    });
}

function getExactDuration(filePath) {
    return new Promise(resolve => {
        execFile(ffprobePath.path, [
            '-v','error',
            '-show_entries','format=duration',
            '-of','default=noprint_wrappers=1:nokey=1',
            filePath
        ], (err, stdout) => {
            const d = parseFloat(stdout);
            resolve(isNaN(d) ? 0 : d);
        });
    });
}

const saveBase64OrUrl = async (input, prefix, ext) => {
    if (!input) {
        console.log(`[Server] Input is empty for ${prefix}`);
        return null;
    }
    const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);
    
    try {
        if (input.startsWith('data:')) {
            const commaIndex = input.indexOf(',');
            if (commaIndex === -1) {
                console.error(`[Server] Invalid Data URI for ${prefix}: No comma found.`);
                return null;
            }
            const base64Data = input.substring(commaIndex + 1);
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(filepath, buffer);
            console.log(`[Server] Saved Data URI as ${filename} (${buffer.length} bytes)`);
            return filename;
        } else if (input.startsWith('http')) {
            console.log(`[Server] Fetching URL for ${prefix}: ${input.substring(0, 50)}...`);
            const res = await fetch(input);
            if (!res.ok) {
                console.error(`[Server] Failed to fetch URL: ${res.statusText}`);
                return null;
            }
            const arrayBuffer = await res.arrayBuffer();
            fs.writeFileSync(filepath, Buffer.from(arrayBuffer));
            console.log(`[Server] Saved URL as ${filename}`);
            return filename;
        } else {
            console.warn(`[Server] Unknown input format for ${prefix}: ${input.substring(0, 30)}...`);
        }
    } catch(e) {
        console.error(`[Server] Error saving asset ${prefix}:`, e);
        return null;
    }
    return null;
};

// ==============================
//      MOVEMENT & FILTERS
// ==============================
function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const fps = 24;
    const totalFrames = Math.ceil(d * fps);
    
    // Critical Change: d=1 ensures frame-by-frame processing for both images (looped) and video streams.
    // fps=24 ensures zoompan generates frames at correct rate.
    const zdur = `:d=1:fps=${fps}:s=${targetW}x${targetH}`;
    const t = `(on/${totalFrames})`; 
    const PI = 3.14159265; 

    const scaleFactor = 2.5; 
    
    const moves = {
        'static': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'kenburns': `zoompan=z='1.0+(0.3*${t})':x='(iw/2-(iw/zoom/2))*(1-0.2*${t})':y='(ih/2-(ih/zoom/2))*(1-0.2*${t})'${zdur}`,
        'mov-3d-float': `zoompan=z='1.1+0.05*sin(on/24)':x='iw/2-(iw/zoom/2)+iw*0.03*sin(on/40)':y='ih/2-(ih/zoom/2)+ih*0.03*sin(on/50)'${zdur}`,
        'mov-tilt-up-slow': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))+(ih/4*${t})'${zdur}`,
        'mov-tilt-down-slow': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))-(ih/4*${t})'${zdur}`,
        'zoom-in': `zoompan=z='1.0+(0.6*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'zoom-out': `zoompan=z='1.6-(0.6*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-crash-in': `zoompan=z='1.0+3*${t}*${t}*${t}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-crash-out': `zoompan=z='4-3*${t}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-bounce-in': `zoompan=z='if(lt(${t},0.8), 1.0+0.5*${t}, 1.5-0.1*sin((${t}-0.8)*20))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-pulse-slow': `zoompan=z='1.1+0.1*sin(on/24)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-dolly-vertigo': `zoompan=z='1.0+(1.0*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-twist-in': `rotate=angle='(${PI}/12)*${t}':fillcolor=black,zoompan=z='1.0+(0.5*${t})'${zdur}`,
        'mov-zoom-wobble': `zoompan=z='1.1':x='iw/2-(iw/zoom/2)+iw*0.05*sin(on/10)':y='ih/2-(ih/zoom/2)+ih*0.05*cos(on/10)'${zdur}`,
        'mov-scale-pulse': `zoompan=z='1.0+0.2*sin(on/10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-l': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1+0.5*${t})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-r': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1-0.5*${t})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-u': `zoompan=z=1.4:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))*(1+0.5*${t})'${zdur}`,
        'mov-pan-slow-d': `zoompan=z=1.4:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))*(1-0.5*${t})'${zdur}`,
        'mov-pan-fast-l': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1+1.0*${t})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-fast-r': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1-1.0*${t})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-diag-tl': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1+0.5*${t})':y='(ih/2-(ih/zoom/2))*(1+0.5*${t})'${zdur}`,
        'mov-pan-diag-br': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1-0.5*${t})':y='(ih/2-(ih/zoom/2))*(1-0.5*${t})'${zdur}`,
        'handheld-1': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+iw*0.02*sin(on/10)':y='ih/2-(ih/zoom/2)+ih*0.02*cos(on/15)'${zdur}`,
        'handheld-2': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+iw*0.04*sin(on/6)':y='ih/2-(ih/zoom/2)+ih*0.04*cos(on/9)'${zdur}`,
        'earthquake': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+iw*0.05*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+ih*0.05*(random(1)-0.5)'${zdur}`,
        'mov-jitter-x': `zoompan=z=1.05:x='iw/2-(iw/zoom/2)+iw*0.02*sin(on*10)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-walk': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+iw*0.02*sin(on/15)':y='ih/2-(ih/zoom/2)+ih*0.015*abs(sin(on/7))'${zdur}`,
        'mov-3d-spin-axis': `rotate=angle='2*${PI}*${t}':fillcolor=black,zoompan=z=1.2${zdur}`,
        'mov-3d-flip-x': `zoompan=z=1${zdur}`,
        'mov-3d-flip-y': `zoompan=z=1${zdur}`,
        'mov-3d-swing-l': `rotate=angle='(${PI}/8)*sin(on/24)':fillcolor=black,zoompan=z=1.2${zdur}`,
        'mov-3d-roll': `rotate=angle='2*${PI}*${t}':fillcolor=black,zoompan=z=1.5${zdur}`,
        'mov-glitch-snap': `zoompan=z='if(mod(on,20)<2, 1.3, 1.0)':x='iw/2-(iw/zoom/2)+if(mod(on,20)<2, iw*0.1, 0)':y='ih/2-(ih/zoom/2)'${zdur},noise=alls=20:allf=t`,
        'mov-glitch-skid': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)+if(mod(on,10)<2, iw*0.2, 0)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-shake-violent': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+iw*0.1*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+ih*0.1*(random(1)-0.5)'${zdur}`,
        'mov-rgb-shift-move': `zoompan=z='1.05+0.05*sin(on/2)'${zdur}`,
        'mov-vibrate': `zoompan=z=1.02:x='iw/2-(iw/zoom/2)+iw*0.01*sin(on*50)':y='ih/2-(ih/zoom/2)+ih*0.01*cos(on*50)'${zdur}`,
        'mov-blur-in': `boxblur=luma_radius='20*(1-${t})':enable='between(t,0,${d})',zoompan=z=1${zdur}`,
        'mov-blur-out': `boxblur=luma_radius='20*${t}':enable='between(t,0,${d})',zoompan=z=1${zdur}`,
        'mov-blur-pulse': `boxblur=luma_radius='10*abs(sin(on/10))',zoompan=z=1${zdur}`,
        'mov-tilt-shift': `boxblur=luma_radius=10:enable='if(between(y,0,h*0.2)+between(y,h*0.8,h),1,0)',zoompan=z=1${zdur}`,
        'mov-rubber-band': `zoompan=z='1.0+0.3*abs(sin(on/10))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-jelly-wobble': `zoompan=z='1.0+0.1*sin(on/5)':x='iw/2-(iw/zoom/2)+iw*0.03*sin(on/4)':y='ih/2-(ih/zoom/2)+ih*0.03*cos(on/4)'${zdur}`,
        'mov-pop-up': `zoompan=z='min(1.0 + ${t}*5, 1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-bounce-drop': `zoompan=z='1.0':y='(ih/2-(ih/zoom/2)) + (ih/2 * abs(cos(${t}*5*${PI})) * (1-${t}))'${zdur}`
    };

    const selected = moves[moveId] || moves['kenburns'];
    const pre = `scale=${Math.ceil(targetW*scaleFactor)}:${Math.ceil(targetH*scaleFactor)}:force_original_aspect_ratio=increase,crop=${Math.ceil(targetW*scaleFactor)}:${Math.ceil(targetH*scaleFactor)},setsar=1`;
    const post = `scale=${targetW}:${targetH}:flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=24,format=yuv420p`;
    return `${pre},${selected},${post}`;
}

function getTransitionXfade(t) {
    const map = {
        'cut': 'cut', 'fade':'fade', 'mix':'dissolve', 'black':'fadeblack', 'white':'fadewhite',
        'slide-left':'slideleft', 'slide-right':'slideright',
        'wipe-left': 'wipeleft', 'wipe-right': 'wiperight', 'wipe-up': 'wipeup', 'wipe-down': 'wipedown',
        'circle-open': 'circleopen', 'circle-close': 'circleclose', 
        'zoom-in': 'zoomin', 'zoom-out': 'zoomout',
        'pixelize': 'pixelize', 'hologram': 'holographic', 'glitch': 'pixelize'
    };
    return map[t] || 'fade';
}

const getVideoArgs = () => ['-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart','-r','24'];
const getAudioArgs = () => ['-c:a','aac','-b:a','192k','-ar','44100','-ac','2'];

// ==============================
//  FRONTEND BUILD
// ==============================
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
//  SERVER CONFIG
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

// ==============================
//  RENDER ENGINE
// ==============================
async function renderVideoProject(project, jobId) {
    const sessionDir = path.join(OUTPUT_DIR, `job_${jobId}`);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    if (!project.clips || project.clips.length === 0) {
        throw new Error("Nenhum clipe para renderizar. Verifique se as imagens/vídeos foram processados corretamente.");
    }

    const tempClips = [];
    const durations = [];
    let targetW = 1280;
    let targetH = 720;
    if (project.aspectRatio === '9:16') { targetW = 720; targetH = 1280; }

    for (let i = 0; i < project.clips.length; i++) {
        const clip = project.clips[i];
        const inputPath = path.join(UPLOAD_DIR, clip.file);
        
        let duration = clip.duration || 5;
        if (duration <= 0) duration = 5;
        durations.push(duration);

        const outFile = path.join(sessionDir, `clip_${i}.mp4`);
        tempClips.push(outFile);

        const args = ["-y"];
        const isVideo = await isVideoFile(inputPath);

        // ALWAYS loop input. For images it's required. For videos, it loops if clip duration > file duration.
        // If clip duration <= file duration, -t cuts it.
        args.push("-stream_loop", "-1", "-i", inputPath);

        let hasExternalAudio = false;
        let hasInternalAudio = false;

        if (clip.audio) {
            const aPath = path.join(UPLOAD_DIR, clip.audio);
            if (fs.existsSync(aPath)) {
                args.push("-i", aPath);
                hasExternalAudio = true;
            }
        }
        if (!hasExternalAudio && isVideo) hasInternalAudio = await fileHasAudio(inputPath);

        // Apply movement filter to ALL clips (images AND videos)
        const movementFilter = getMovementFilter(clip.movement || "kenburns", duration, targetW, targetH);
        let filterComplex = `[0:v]${movementFilter}[v_out];`;
        
        if (hasExternalAudio) filterComplex += `[1:a]apad,atrim=0:${duration},aformat=sample_rates=44100:channel_layouts=stereo[a_out]`;
        else if (hasInternalAudio) filterComplex += `[0:a]apad,atrim=0:${duration},aformat=sample_rates=44100:channel_layouts=stereo[a_out]`;
        else filterComplex += `anullsrc=channel_layout=stereo:sample_rate=44100:d=${duration},aformat=sample_rates=44100:channel_layouts=stereo[a_out]`;

        args.push("-filter_complex", filterComplex, "-map", "[v_out]", "-map", "[a_out]", "-t", duration.toString(), ...getVideoArgs(), ...getAudioArgs(), outFile);

        await runFFmpeg(args).catch(e => { console.error(`Failed clip ${i}:`, e); throw e; });
        jobs[jobId].progress = Math.floor((i / project.clips.length) * 45);
    }

    const concatOut = path.join(sessionDir, "video_final.mp4");
    const trType = getTransitionXfade(project.transition || "fade");

    if (tempClips.length === 1) {
        fs.copyFileSync(tempClips[0], concatOut);
        jobs[jobId].progress = 70;
    } else if (trType === 'cut') {
        const listPath = path.join(sessionDir, "concat_list.txt");
        const listContent = tempClips.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(listPath, listContent);
        try { await runFFmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", concatOut]); } 
        catch (e) { await runFFmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, ...getVideoArgs(), ...getAudioArgs(), concatOut]); }
        jobs[jobId].progress = 70;
    } else {
        const inputArgs = [];
        tempClips.forEach(path => inputArgs.push("-i", path));
        let filterGraph = "";
        let prevLabelV = "[0:v]";
        let prevLabelA = "[0:a]";
        let outIndex = 0;
        const trDur = project.transitionDuration || 1.0;
        let timeCursor = durations[0];

        for (let i = 1; i < tempClips.length; i++) {
            const offset = timeCursor - trDur;
            const outLabelV = `[v${outIndex + 1}]`;
            const outLabelA = `[a${outIndex + 1}]`;
            filterGraph += `${prevLabelV}[${i}:v]xfade=transition=${trType}:duration=${trDur}:offset=${offset}${outLabelV};`;
            filterGraph += `${prevLabelA}[${i}:a]acrossfade=d=${trDur}:c1=tri:c2=tri[a_tmp${i}];`;
            filterGraph += `[a_tmp${i}]aformat=sample_rates=44100:channel_layouts=stereo${outLabelA};`;
            prevLabelV = outLabelV;
            prevLabelA = outLabelA;
            outIndex++;
            timeCursor += (durations[i] - trDur);
        }
        await runFFmpeg(["-y", ...inputArgs, "-filter_complex", filterGraph, "-map", prevLabelV, "-map", prevLabelA, ...getVideoArgs(), ...getAudioArgs(), concatOut]);
        jobs[jobId].progress = 70;
    }

    const bgm = project.audio?.bgm ? path.join(UPLOAD_DIR, project.audio.bgm) : null;
    let finalOutput = path.join(OUTPUT_DIR, `video_${jobId}.mp4`);

    if (bgm && fs.existsSync(bgm)) {
        const duration = durations.reduce((a,b)=>a+b, 0);
        const mixGraph = `[1:a]aloop=loop=-1:size=2e+09,volume=${project.audio.bgmVolume ?? 0.2}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[a_final]`;
        await runFFmpeg(["-y", "-i", concatOut, "-i", bgm, "-filter_complex", mixGraph, "-map", "0:v", "-map", "[a_final]", "-t", duration.toString(), ...getVideoArgs(), ...getAudioArgs(), finalOutput]);
    } else {
        fs.copyFileSync(concatOut, finalOutput);
    }

    jobs[jobId].progress = 100;
    return finalOutput;
}

function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const ff = spawn(ffmpegPath, args);
        let errData = "";
        ff.stderr.on('data', d => errData += d.toString());
        ff.on("close", code => {
            if (code === 0) resolve();
            else reject(`FFmpeg error ${code}: ${errData.slice(-300)}`);
        });
    });
}

// ==============================
//      ROUTES
// ==============================

// Main Render Endpoint with JSON/Multipart separation
app.post("/api/render/start", async (req, res) => {
    const contentType = req.headers['content-type'] || '';
    const jobId = Date.now().toString();
    jobs[jobId] = { progress: 1, status: "processing" };

    // 1. JSON Mode (Magic Workflow, no file upload)
    if (contentType.includes('application/json')) {
        try {
            const scenes = req.body.scenes;
            const config = req.body.config || {};
            const bgmUrl = req.body.bgmUrl;

            if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
                return res.status(400).json({ error: "Invalid scenes data" });
            }

            const project = {
                clips: [],
                audio: { bgm: null, bgmVolume: config.musicVolume || 0.2, sfxVolume: config.sfxVolume || 0.5 },
                transition: config.transition || 'cut', 
                transitionDuration: 1.0,
                aspectRatio: config.aspectRatio || '16:9'
            };

            if (bgmUrl) project.audio.bgm = await saveBase64OrUrl(bgmUrl, 'bgm', 'mp3');

            for (let i = 0; i < scenes.length; i++) {
                const s = scenes[i];
                let visualFile = null;
                // Save visual content (Video or Image)
                if (s.videoUrl) visualFile = await saveBase64OrUrl(s.videoUrl, `scene_${i}_vid`, 'mp4');
                else if (s.imageUrl) visualFile = await saveBase64OrUrl(s.imageUrl, `scene_${i}_img`, 'png');

                let audioFile = null;
                if (s.audioUrl) audioFile = await saveBase64OrUrl(s.audioUrl, `scene_${i}_audio`, 'wav');

                if (visualFile) {
                    project.clips.push({
                        file: visualFile,
                        audio: audioFile,
                        duration: parseFloat(s.duration || 5),
                        movement: s.effect || config.movement || 'kenburns'
                    });
                } else {
                    console.warn(`[Server] Scene ${i} ignored: No visual file saved.`);
                }
            }

            renderVideoProject(project, jobId)
                .then(outputPath => {
                    jobs[jobId].status = "completed";
                    jobs[jobId].downloadUrl = `/outputs/${path.basename(outputPath)}`;
                })
                .catch(err => {
                    console.error("Render error (JSON):", err);
                    jobs[jobId].status = "failed";
                    jobs[jobId].error = err.toString();
                });

            return res.json({ jobId });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    } 
    // 2. Multipart Mode (Manual/Turbo Uploads)
    else {
        uploadAny(req, res, async (err) => {
            if (err) return res.status(500).json({ error: "Upload failed: " + err.message });

            try {
                let config = {};
                if (req.body.config) {
                    try { config = typeof req.body.config === 'string' ? JSON.parse(req.body.config) : req.body.config; } catch(e) {}
                }

                const project = {
                    clips: [],
                    audio: { bgm: null, bgmVolume: config.musicVolume || 0.2, sfxVolume: config.sfxVolume || 0.5 },
                    transition: config.transition || 'cut', 
                    transitionDuration: 1.0,
                    aspectRatio: config.aspectRatio || '16:9'
                };

                const files = req.files || [];
                const visuals = files.filter(f => f.fieldname === 'visualFiles');
                const audios = files.filter(f => f.fieldname === 'audioFiles');
                const extras = files.filter(f => f.fieldname === 'additionalFiles');

                const bgmFile = extras.find(f => f.originalname.includes('background_music'));
                if (bgmFile) project.audio.bgm = bgmFile.filename;

                for (let i = 0; i < visuals.length; i++) {
                    const vFile = visuals[i];
                    const aFile = audios[i]; 
                    const meta = config.sceneData ? config.sceneData[i] : {};

                    project.clips.push({
                        file: vFile.filename,
                        audio: aFile ? aFile.filename : null,
                        duration: parseFloat(meta?.duration || 5),
                        movement: config.movement || 'kenburns'
                    });
                }

                if (project.clips.length === 0) {
                    return res.status(400).json({ error: "No clips provided" });
                }

                renderVideoProject(project, jobId)
                    .then(outputPath => {
                        jobs[jobId].status = "completed";
                        jobs[jobId].downloadUrl = `/outputs/${path.basename(outputPath)}`;
                    })
                    .catch(err => {
                        console.error("Render error:", err);
                        jobs[jobId].status = "failed";
                        jobs[jobId].error = err.toString();
                    });

                res.json({ jobId });

            } catch (err) {
                console.error("API render error:", err);
                res.status(500).json({ error: "Erro ao iniciar renderização" });
            }
        });
    }
});

app.post("/api/upload", (req, res) => {
    uploadAny(req, res, (err) => {
        if (err) return res.status(500).json({ error: "Falha no upload", details: err });
        res.json({ files: req.files || [] });
    });
});

app.post("/api/process/start/merge", async (req, res) => {
    uploadAny(req, res, async (err) => {
        if (err) return res.status(500).json({ error: "Upload failed" });
        try {
            const jobId = Date.now().toString();
            jobs[jobId] = { progress: 1, status: "processing" };
            
            const files = req.files || [];
            if (files.length < 2) throw new Error("Requires video + audio");
            
            const videoFile = files.find(f => f.mimetype.startsWith('video')) || files[0];
            const audioFile = files.find(f => f.mimetype.startsWith('audio')) || files[1];
            
            const vPath = path.join(UPLOAD_DIR, videoFile.filename);
            const aPath = path.join(UPLOAD_DIR, audioFile.filename);
            const outPath = path.join(OUTPUT_DIR, `merged_${jobId}.mp4`);
            
            const args = ["-y", "-i", vPath, "-i", aPath, "-c:v", "copy", "-c:a", "aac", "-map", "0:v:0", "-map", "1:a:0", "-shortest", outPath];
            if (videoFile.mimetype.startsWith('image')) {
                 const dur = await getExactDuration(aPath) || 10;
                 args.splice(3, 2); args.splice(1, 0, "-loop", "1"); args.push("-t", dur.toString(), ...getVideoArgs());
            }

            runFFmpeg(args).then(() => {
                jobs[jobId].status = "completed"; jobs[jobId].downloadUrl = `/outputs/${path.basename(outPath)}`; jobs[jobId].progress = 100;
            }).catch(e => { jobs[jobId].status = "failed"; jobs[jobId].error = e.toString(); });

            res.json({ jobId });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

app.post("/api/process/start/:action", async (req, res) => {
    uploadAny(req, res, async (err) => {
        if (err) return res.status(500).json({ error: "Upload failed" });
        const jobId = Date.now().toString();
        const files = req.files || [];
        if (files.length > 0) {
            jobs[jobId] = { status: "completed", progress: 100, downloadUrl: `/uploads/${files[0].filename}` };
        } else {
            jobs[jobId] = { status: "failed", error: "No files provided" };
        }
        res.json({ jobId });
    });
});

app.post("/api/image/start/:action", async (req, res) => {
    uploadAny(req, res, async (err) => {
        if (err) return res.status(500).json({ error: "Upload failed" });
        const jobId = Date.now().toString();
        const files = req.files || [];
        if (files.length > 0) {
            jobs[jobId] = { status: "completed", progress: 100, downloadUrl: `/uploads/${files[0].filename}` };
        } else {
            jobs[jobId] = { status: "failed", error: "No files provided" };
        }
        res.json({ jobId });
    });
});

app.get("/api/process/status/:id", (req, res) => {
    const job = jobs[req.params.id];
    if (!job) return res.status(404).json({ status: "not_found" });
    res.json(job);
});

app.get("/api/download/:file", (req, res) => {
    const filePath = path.join(OUTPUT_DIR, req.params.file);
    if (!fs.existsSync(filePath)) return res.status(404).send("Arquivo não encontrado.");
    res.download(filePath);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Turbo Server Running on Port ${PORT}`);
});
