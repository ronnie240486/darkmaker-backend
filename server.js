
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

const FFMPEG_BIN = typeof ffmpegPath === 'string' ? ffmpegPath : ffmpegPath.path;
const FFPROBE_BIN = typeof ffprobePath === 'string' ? ffprobePath : ffprobePath.path;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

[UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach(dir => {
    if (fs.existsSync(dir) && !fs.lstatSync(dir).isDirectory()) {
        fs.rmSync(dir, { force: true });
    }
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

async function getMediaInfo(file) {
    return new Promise(resolve => {
        execFile(FFPROBE_BIN, [
            "-v", "error",
            "-show_entries", "stream=codec_type,duration,width,height",
            "-of", "json",
            file
        ], (err, stdout) => {
            try {
                const info = JSON.parse(stdout);
                const hasAudio = info.streams.some(s => s.codec_type === 'audio');
                const hasVideo = info.streams.some(s => s.codec_type === 'video');
                resolve({ hasAudio, hasVideo, data: info });
            } catch (e) {
                resolve({ hasAudio: false, hasVideo: false, data: {} });
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
    } catch(e) { console.error("Save Error:", e); return null; }
    return null;
};

function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const w = targetW;
    const h = targetH;
    const fps = 24;
    
    const zNorm = `(time/${d})`; 
    const rNorm = `(t/${d})`;
    const PI = 3.14159; 

    const zp = `zoompan=d=1:fps=${fps}:s=${w}x${h}`;
    const center = `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    const scaleFactor = 2.0; 

    const moves = {
        'static': `${zp}:z=1.0${center}`,
        'kenburns': `${zp}:z='1.0+(0.3*${zNorm})':x='(iw/2-(iw/zoom/2))*(1-0.2*${zNorm})':y='(ih/2-(ih/zoom/2))*(1-0.2*${zNorm})'`,
        'mov-3d-float': `${zp}:z='1.1+0.05*sin(time*2)':x='iw/2-(iw/zoom/2)+iw*0.03*sin(time)':y='ih/2-(ih/zoom/2)+ih*0.03*cos(time)'`,
        'mov-tilt-up-slow': `${zp}:z=1.2:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))+(ih/4*${zNorm})'`,
        'mov-tilt-down-slow': `${zp}:z=1.2:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))-(ih/4*${zNorm})'`,
        'zoom-in': `${zp}:z='1.0+(0.6*${zNorm})'${center}`,
        'zoom-out': `${zp}:z='1.6-(0.6*${zNorm})'${center}`,
        'mov-zoom-crash-in': `${zp}:z='1.0+3*${zNorm}*${zNorm}*${zNorm}'${center}`,
        'mov-zoom-crash-out': `${zp}:z='4-3*${zNorm}'${center}`,
        'mov-zoom-bounce-in': `${zp}:z='if(lt(${zNorm},0.8), 1.0+0.5*${zNorm}, 1.5-0.1*sin((${zNorm}-0.8)*20))'${center}`,
        'mov-zoom-pulse-slow': `${zp}:z='1.1+0.1*sin(time*2)'${center}`,
        'mov-dolly-vertigo': `${zp}:z='1.0+(1.0*${zNorm})'${center}`,
        'mov-3d-spin-axis': `rotate=angle=2*${PI}*${rNorm}:fillcolor=black:ow=iw:oh=ih,${zp}:z=1.7${center}`,
        'mov-3d-roll': `rotate=angle=-2*${PI}*${rNorm}:fillcolor=black:ow=iw:oh=ih,${zp}:z=1.7${center}`,
        'mov-zoom-twist-in': `rotate=angle=(${PI}/8)*${rNorm}:fillcolor=black,${zp}:z='1.0+(0.5*${zNorm})'${center}`,
        'mov-3d-swing-l': `rotate=angle=(${PI}/8)*sin(t):fillcolor=black:ow=iw:oh=ih,${zp}:z=1.3${center}`,
        'mov-3d-flip-x': `${zp}:z='1.0+0.4*abs(sin(time*3))':x='iw/2-(iw/zoom/2)+(iw/4)*sin(time*5)'${center}`,
        'mov-3d-flip-y': `${zp}:z='1.0+0.4*abs(cos(time*3))':y='ih/2-(ih/zoom/2)+(ih/4)*cos(time*5)'${center}`,
        'mov-zoom-wobble': `${zp}:z='1.1':x='iw/2-(iw/zoom/2)+iw*0.05*sin(time*2)':y='ih/2-(ih/zoom/2)+ih*0.05*cos(time*2)'`,
        'mov-scale-pulse': `${zp}:z='1.0+0.2*sin(time*3)'${center}`,
        'mov-pan-slow-l': `${zp}:z=1.4:x='(iw/2-(iw/zoom/2))*(1+0.5*${zNorm})'${center}`,
        'mov-pan-slow-r': `${zp}:z=1.4:x='(iw/2-(iw/zoom/2))*(1-0.5*${zNorm})'${center}`,
        'mov-pan-slow-u': `${zp}:z=1.4:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))*(1+0.5*${zNorm})'`,
        'mov-pan-slow-d': `${zp}:z=1.4:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))*(1-0.5*${zNorm})'`,
        'mov-pan-fast-l': `${zp}:z=1.4:x='(iw/2-(iw/zoom/2))*(1+1.0*${zNorm})'${center}`,
        'mov-pan-fast-r': `${zp}:z=1.4:x='(iw/2-(iw/zoom/2))*(1-1.0*${zNorm})'${center}`,
        'mov-pan-diag-tl': `${zp}:z=1.4:x='(iw/2-(iw/zoom/2))*(1+0.5*${zNorm})':y='(ih/2-(ih/zoom/2))*(1+0.5*${zNorm})'`,
        'mov-pan-diag-br': `${zp}:z=1.4:x='(iw/2-(iw/zoom/2))*(1-0.5*${zNorm})':y='(ih/2-(ih/zoom/2))*(1-0.5*${zNorm})'`,
        'handheld-1': `${zp}:z=1.1:x='iw/2-(iw/zoom/2)+iw*0.02*sin(time)':y='ih/2-(ih/zoom/2)+ih*0.02*cos(time*1.5)'`,
        'handheld-2': `${zp}:z=1.1:x='iw/2-(iw/zoom/2)+iw*0.04*sin(time*2)':y='ih/2-(ih/zoom/2)+ih*0.04*cos(time*0.5)'`,
        'earthquake': `${zp}:z=1.1:x='iw/2-(iw/zoom/2)+iw*0.05*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+ih*0.05*(random(1)-0.5)'`,
        'mov-jitter-x': `${zp}:z=1.05:x='iw/2-(iw/zoom/2)+iw*0.02*sin(time*20)'${center}`,
        'mov-walk': `${zp}:z=1.1:x='iw/2-(iw/zoom/2)+iw*0.02*sin(time)':y='ih/2-(ih/zoom/2)+ih*0.015*abs(sin(time*2))'`,
        'mov-glitch-snap': `${zp}:z='if(lt(mod(time,1.0),0.1), 1.3, 1.0)':x='iw/2-(iw/zoom/2)+if(lt(mod(time,1.0),0.1), iw*0.1, 0)'${center},noise=alls=20:allf=t`,
        'mov-glitch-skid': `${zp}:z=1.0:x='iw/2-(iw/zoom/2)+if(lt(mod(time,0.5),0.1), iw*0.2, 0)'${center}`,
        'mov-shake-violent': `${zp}:z=1.2:x='iw/2-(iw/zoom/2)+iw*0.1*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+ih*0.1*(random(1)-0.5)'`,
        'mov-rgb-shift-move': `rgbashift=rh=20:bv=20,${zp}:z=1.05${center}`,
        'mov-vibrate': `${zp}:z=1.02:x='iw/2-(iw/zoom/2)+iw*0.01*sin(time*50)':y='ih/2-(ih/zoom/2)+ih*0.01*cos(time*50)'`,
        'mov-blur-in': `gblur=sigma='20*max(0,1-${rNorm})':steps=2,${zp}:z=1${center}`,
        'mov-blur-out': `gblur=sigma='min(20,20*${rNorm})':steps=2,${zp}:z=1${center}`,
        'mov-blur-pulse': `gblur=sigma='10*abs(sin(t*2))':steps=1,${zp}:z=1${center}`,
        'mov-tilt-shift': `eq=saturation=1.4:contrast=1.1,${zp}:z=1.1${center}`,
        'mov-rubber-band': `${zp}:z='1.0+0.3*abs(sin(time*2))'${center}`,
        'mov-jelly-wobble': `${zp}:z='1.0+0.1*sin(time)':x='iw/2-(iw/zoom/2)+iw*0.03*sin(time*2)':y='ih/2-(ih/zoom/2)+iw*0.03*cos(time*2)'`,
        'mov-pop-up': `${zp}:z='min(1.0 + ${zNorm}*5, 1.0)'${center}`,
        'mov-bounce-drop': `${zp}:z='1.0':y='(ih/2-(ih/zoom/2)) + (ih/2 * abs(cos(${zNorm}*5*${PI})) * (1-${zNorm}))'`
    };

    const selected = moves[moveId] || moves['kenburns'];
    const pre = `scale=${Math.ceil(w*scaleFactor)}:${Math.ceil(h*scaleFactor)}:force_original_aspect_ratio=increase,crop=${Math.ceil(w*scaleFactor)}:${Math.ceil(h*scaleFactor)},setsar=1`;
    const post = `scale=${w}:${h}:flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=${fps},format=yuv420p`;
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

const getVideoArgs = () => ['-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-movflags','+faststart','-r','24'];
const getAudioArgs = () => ['-c:a','aac','-b:a','128k','-ar','44100','-ac', '2'];

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
    } catch(e) { console.error("Frontend build error:", e); }
}
await buildFrontend();

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

async function renderVideoProject(project, jobId) {
    const sessionDir = path.join(OUTPUT_DIR, `job_${jobId}`);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    if (!project.clips || project.clips.length === 0) {
        throw new Error("Nenhum clipe para renderizar.");
    }

    const tempClips = [];
    const durations = [];
    let targetW = 1280;
    let targetH = 720;
    if (project.aspectRatio === '9:16') { targetW = 720; targetH = 1280; }

    for (let i = 0; i < project.clips.length; i++) {
        const clip = project.clips[i];
        const inputPath = path.join(UPLOAD_DIR, clip.file);
        
        let duration = parseFloat(clip.duration) || 5;
        if (duration <= 0) duration = 5;
        durations.push(duration);

        const outFile = path.join(sessionDir, `clip_${i}.mp4`);
        tempClips.push(outFile);

        const info = await getMediaInfo(inputPath);
        const args = ["-y"];

        if (info.hasVideo) {
            args.push("-stream_loop", "-1", "-i", inputPath);
        } else {
            args.push("-loop", "1", "-framerate", "24", "-i", inputPath);
        }

        let audioSourceIdx = -1;
        if (clip.audio) {
            const aPath = path.join(UPLOAD_DIR, clip.audio);
            if (fs.existsSync(aPath)) {
                args.push("-i", aPath);
                audioSourceIdx = 1; 
            }
        } else if (info.hasAudio) {
            audioSourceIdx = 0;
        }

        const movementFilter = getMovementFilter(clip.movement || "kenburns", duration, targetW, targetH);
        let filterComplex = `[0:v]${movementFilter}[v_processed];`;
        const audioFmt = "aformat=sample_rates=44100:channel_layouts=stereo:sample_fmts=fltp";
        
        if (audioSourceIdx !== -1) {
            filterComplex += `[${audioSourceIdx}:a]atrim=0:${duration},apad,${audioFmt}[a_processed]`;
        } else {
            filterComplex += `anullsrc=channel_layout=stereo:sample_rate=44100:d=${duration},${audioFmt}[a_processed]`;
        }

        args.push("-filter_complex", filterComplex, "-map", "[v_processed]", "-map", "[a_processed]", "-t", duration.toFixed(3), ...getVideoArgs(), ...getAudioArgs(), outFile);

        try {
            await runFFmpeg(args);
        } catch (e) {
            throw new Error(`Erro na Cena ${i+1}: ${e}`);
        }

        jobs[jobId].progress = Math.floor((i / project.clips.length) * 40);
    }

    const concatOut = path.join(sessionDir, "video_composite.mp4");
    const trType = getTransitionXfade(project.transition || "fade");

    if (tempClips.length === 1) {
        fs.copyFileSync(tempClips[0], concatOut);
    } else if (trType === 'cut') {
        const listPath = path.join(sessionDir, "concat_list.txt");
        const listContent = tempClips.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(listPath, listContent);
        await runFFmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", concatOut]);
    } else {
        const inputArgs = [];
        tempClips.forEach(path => inputArgs.push("-i", path));
        
        const minDuration = Math.min(...durations);
        let trDur = 0.5; // Transição padrão fixa para estabilidade
        if (trDur * 2 > minDuration) trDur = minDuration / 2.5;
        
        let filterGraph = "";
        let prevLabelV = "[0:v]";
        let prevLabelA = "[0:a]";
        let timeCursor = durations[0];

        for (let i = 1; i < tempClips.length; i++) {
            const offset = Math.max(0.1, timeCursor - trDur).toFixed(3); 
            const outLabelV = `[v_join${i}]`;
            const outLabelA = `[a_join${i}]`;
            
            filterGraph += `${prevLabelV}[${i}:v]xfade=transition=${trType}:duration=${trDur}:offset=${offset}${outLabelV};`;
            filterGraph += `${prevLabelA}[${i}:a]acrossfade=d=${trDur}:c1=tri:c2=tri[a_xfade${i}];`;
            filterGraph += `[a_xfade${i}]aformat=sample_rates=44100:channel_layouts=stereo:sample_fmts=fltp${outLabelA};`;
            
            prevLabelV = outLabelV;
            prevLabelA = outLabelA;
            timeCursor += (durations[i] - trDur);
        }
        
        await runFFmpeg(["-y", ...inputArgs, "-filter_complex", filterGraph, "-map", prevLabelV, "-map", prevLabelA, ...getVideoArgs(), ...getAudioArgs(), concatOut]);
    }

    jobs[jobId].progress = 80;

    const bgm = project.audio?.bgm ? path.join(UPLOAD_DIR, project.audio.bgm) : null;
    let finalOutput = path.join(OUTPUT_DIR, `video_${jobId}.mp4`);

    if (bgm && fs.existsSync(bgm)) {
        const mixGraph = `[1:a]aloop=loop=-1:size=2e+09,volume=${project.audio.bgmVolume ?? 0.2}[bgm_loop];[0:a][bgm_loop]amix=inputs=2:duration=first:dropout_transition=0,aformat=sample_rates=44100:channel_layouts=stereo:sample_fmts=fltp[a_final]`;
        await runFFmpeg(["-y", "-i", concatOut, "-i", bgm, "-filter_complex", mixGraph, "-map", "0:v", "-map", "[a_final]", ...getVideoArgs(), ...getAudioArgs(), finalOutput]);
    } else {
        fs.copyFileSync(concatOut, finalOutput);
    }

    jobs[jobId].progress = 100;
    return finalOutput;
}

function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const ff = spawn(FFMPEG_BIN, args);
        let errData = "";
        ff.stderr.on('data', d => {
            errData += d.toString();
        });
        ff.on("close", code => {
            if (code === 0) resolve();
            else {
                console.error("FFMPEG ERROR OUTPUT:", errData);
                reject(`FFmpeg failed (${code}): ${errData.slice(-300)}`);
            }
        });
    });
}

app.post("/api/render/start", async (req, res) => {
    const contentType = req.headers['content-type'] || '';
    const jobId = Date.now().toString();
    jobs[jobId] = { progress: 1, status: "processing" };

    if (contentType.includes('application/json')) {
        try {
            const { scenes, config, bgmUrl } = req.body;
            if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
                return res.status(400).json({ error: "Dados de cena inválidos." });
            }

            const project = {
                clips: [],
                audio: { bgm: null, bgmVolume: config.musicVolume || 0.2 },
                transition: config.transition || 'fade', 
                aspectRatio: config.aspectRatio || '16:9'
            };

            if (bgmUrl) project.audio.bgm = await saveBase64OrUrl(bgmUrl, 'bgm', 'mp3');

            for (let i = 0; i < scenes.length; i++) {
                const s = scenes[i];
                let visualFile = null;
                if (s.videoUrl) visualFile = await saveBase64OrUrl(s.videoUrl, `scene_${i}_v`, 'mp4');
                else if (s.imageUrl) visualFile = await saveBase64OrUrl(s.imageUrl, `scene_${i}_i`, 'png');

                let audioFile = null;
                if (s.audioUrl) audioFile = await saveBase64OrUrl(s.audioUrl, `scene_${i}_a`, 'wav');

                if (visualFile) {
                    project.clips.push({
                        file: visualFile,
                        audio: audioFile,
                        duration: parseFloat(s.duration || 5),
                        movement: s.effect || config.movement || 'kenburns'
                    });
                }
            }

            renderVideoProject(project, jobId)
                .then(outputPath => {
                    jobs[jobId].status = "completed";
                    jobs[jobId].downloadUrl = `/outputs/${path.basename(outputPath)}`;
                })
                .catch(err => {
                    jobs[jobId].status = "failed";
                    jobs[jobId].error = err.toString();
                });

            return res.json({ jobId });
        } catch (e) { return res.status(500).json({ error: e.message }); }
    } else {
        uploadAny(req, res, async (err) => {
            if (err) return res.status(500).json({ error: "Upload falhou." });
            try {
                let config = {};
                if (req.body.config) {
                    try { config = typeof req.body.config === 'string' ? JSON.parse(req.body.config) : req.body.config; } catch(e) {}
                }
                const project = {
                    clips: [],
                    audio: { bgm: null, bgmVolume: config.musicVolume || 0.2 },
                    transition: config.transition || 'fade', 
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
                
                renderVideoProject(project, jobId)
                    .then(outputPath => {
                        jobs[jobId].status = "completed";
                        jobs[jobId].downloadUrl = `/outputs/${path.basename(outputPath)}`;
                    })
                    .catch(err => {
                        jobs[jobId].status = "failed";
                        jobs[jobId].error = err.toString();
                    });
                res.json({ jobId });
            } catch (err) { res.status(500).json({ error: "Erro ao iniciar render." }); }
        });
    }
});

app.post("/api/proxy", async (req, res) => {
    const { url, method, headers, body } = req.body;
    try {
        const response = await fetch(url, {
            method: method || 'GET',
            headers: headers || { 'Content-Type': 'application/json' },
            body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
        });
        const contentType = response.headers.get("content-type");
        const responseData = contentType?.includes("application/json") ? await response.json() : await response.text();
        res.status(response.status).json(responseData);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/process/status/:id", (req, res) => {
    const job = jobs[req.params.id];
    if (!job) return res.status(404).json({ status: "not_found" });
    res.json(job);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Media Suite Backend Running on Port ${PORT}`);
});
