
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
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ==============================
//      FILE CHECKS
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

// ==============================
//      DURATION
// ==============================
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

// ==============================
//      MOVEMENT FILTERS
// ==============================
function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const fps = 24;
    const totalFrames = Math.ceil(d * fps);
    const zdur = `:d=${totalFrames}:s=${targetW}x${targetH}`;
    const t = `(on/${totalFrames})`;

    const moves = {
        'static': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'kenburns': `zoompan=z='1.0+(0.3*${t})':x='(iw/2-(iw/zoom/2))*(1-0.2*${t})':y='(ih/2-(ih/zoom/2))*(1-0.2*${t})'${zdur}`,
        'zoom-in': `zoompan=z='1.0+(0.5*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'zoom-out': `zoompan=z='1.5-(0.5*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-l': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1+0.5*${t})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-r': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1-0.5*${t})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'handheld-1': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+10*sin(on/10)':y='ih/2-(ih/zoom/2)+10*cos(on/15)'${zdur}`
    };

    const selected = moves[moveId] || moves['kenburns'];

    const pre = `scale=${targetW*2}:${targetH*2}:force_original_aspect_ratio=increase,crop=${targetW*2}:${targetH*2},setsar=1`;
    const post = `scale=${targetW}:${targetH},pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=24,format=yuv420p`;

    return `${pre},${selected},${post}`;
}

// ==============================
//      TRANSIÇÕES
// ==============================
function getTransitionXfade(t) {
    const map = {
        'cut': 'cut',
        'fade':'fade',
        'mix':'dissolve',
        'black':'fadeblack',
        'white':'fadewhite',
        'slide-left':'slideleft',
        'slide-right':'slideright'
    };
    return map[t] || 'fade';
}

// ==============================
//      ARGS PADRÃO
// ==============================
const getVideoArgs = () => [
    '-c:v','libx264',
    '-preset','ultrafast',
    '-pix_fmt','yuv420p',
    '-movflags','+faststart',
    '-r','24'
];

const getAudioArgs = () => [
    '-c:a','aac',
    '-b:a','192k',
    '-ar','44100',
    '-ac','2'
];

// ==============================
//  FRONTEND BUILD
// ==============================
async function buildFrontend() {
    try {
        const copySafe = (src, dest) => {
            if (fs.existsSync(src)) {
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

    } catch(e) {
        console.error("Frontend error:", e);
    }
}

await buildFrontend();

// ==============================
//  SERVER PREFS
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

// ============================================================================
//                           RENDER ENGINE
// ============================================================================

async function renderVideoProject(project, jobId) {
    const sessionDir = path.join(OUTPUT_DIR, `job_${jobId}`);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const tempClips = [];
    const durations = [];

    let targetW = 1280;
    let targetH = 720;
    if (project.aspectRatio === '9:16') {
        targetW = 720;
        targetH = 1280;
    }

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

        if (isVideo) {
             args.push("-stream_loop", "-1", "-i", inputPath);
        } else {
             args.push("-loop", "1", "-i", inputPath);
        }

        let hasExternalAudio = false;
        let hasInternalAudio = false;

        if (clip.audio) {
            const aPath = path.join(UPLOAD_DIR, clip.audio);
            if (fs.existsSync(aPath)) {
                args.push("-i", aPath);
                hasExternalAudio = true;
            }
        }

        if (!hasExternalAudio) {
            hasInternalAudio = await fileHasAudio(inputPath);
        }

        let filterComplex = "";

        if (isVideo) {
            const pre = `scale=${targetW*2}:${targetH*2}:force_original_aspect_ratio=increase,crop=${targetW*2}:${targetH*2},setsar=1`;
            const post = `scale=${targetW}:${targetH},pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=24,format=yuv420p`;
            filterComplex = `[0:v]${pre},${post}[v_out];`;
        } else {
            const movementFilter = getMovementFilter(clip.movement || "kenburns", duration, targetW, targetH);
            filterComplex = `[0:v]${movementFilter}[v_out];`;
        }
        
        // Audio processing logic ensures consistency for concat
        if (hasExternalAudio) {
            filterComplex += `[1:a]apad,atrim=0:${duration},aformat=sample_rates=44100:channel_layouts=stereo[a_out]`;
        } else if (hasInternalAudio) {
            filterComplex += `[0:a]apad,atrim=0:${duration},aformat=sample_rates=44100:channel_layouts=stereo[a_out]`;
        } else {
            filterComplex += `anullsrc=channel_layout=stereo:sample_rate=44100:d=${duration}[a_out]`;
        }

        args.push(
            "-filter_complex", filterComplex,
            "-map", "[v_out]",
            "-map", "[a_out]",
            "-t", duration.toString(),
            ...getVideoArgs(),
            ...getAudioArgs(),
            outFile
        );

        await runFFmpeg(args).catch(e => {
            console.error(`Failed to process clip ${i}:`, e);
            throw e;
        });
        
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

        try {
            await runFFmpeg([
                "-y", "-f", "concat", "-safe", "0", "-i", listPath,
                "-c", "copy",
                concatOut
            ]);
        } catch (e) {
            // Re-encode if copy fails
            await runFFmpeg([
                "-y", "-f", "concat", "-safe", "0", "-i", listPath,
                ...getVideoArgs(), ...getAudioArgs(),
                concatOut
            ]);
        }
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
            filterGraph += `${prevLabelA}[${i}:a]acrossfade=d=${trDur}:c1=tri:c2=tri${outLabelA};`;

            prevLabelV = outLabelV;
            prevLabelA = outLabelA;
            outIndex++;
            timeCursor += (durations[i] - trDur);
        }

        await runFFmpeg([
            "-y", ...inputArgs,
            "-filter_complex", filterGraph,
            "-map", prevLabelV, "-map", prevLabelA,
            ...getVideoArgs(), ...getAudioArgs(),
            concatOut
        ]);
        jobs[jobId].progress = 70;
    }

    const bgm = project.audio?.bgm ? path.join(UPLOAD_DIR, project.audio.bgm) : null;
    let finalOutput = path.join(OUTPUT_DIR, `video_${jobId}.mp4`);

    if (bgm && fs.existsSync(bgm)) {
        // Ensure inputs match duration roughly
        const duration = durations.reduce((a,b)=>a+b, 0);
        // Use apad to extend concatOut just in case, and amix
        const mixGraph = `[1:a]aloop=loop=-1:size=2e+09,volume=${project.audio.bgmVolume ?? 0.2},apad[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[a_final]`;
        
        await runFFmpeg([
            "-y", "-i", concatOut, "-i", bgm,
            "-filter_complex", mixGraph,
            "-map", "0:v", "-map", "[a_final]",
            "-t", duration.toString(),
            ...getVideoArgs(), ...getAudioArgs(),
            finalOutput
        ]);
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
            else reject(`FFmpeg error ${code}: ${errData.slice(-200)}`);
        });
    });
}

// ==============================
//      ROUTES
// ==============================

app.post("/api/upload", (req, res) => {
    uploadAny(req, res, (err) => {
        if (err) return res.status(500).json({ error: "Falha no upload", details: err });
        res.json({ files: req.files });
    });
});

app.post("/api/render/start", async (req, res) => {
    uploadAny(req, res, async (err) => {
        if (err) return res.status(500).json({ error: "Upload failed" });

        try {
            const jobId = Date.now().toString();
            jobs[jobId] = { progress: 1, status: "processing" };

            let config = {};
            if (req.body.config) {
                try { config = JSON.parse(req.body.config); } catch(e) {}
            }

            const project = {
                clips: [],
                audio: {
                    bgm: null,
                    bgmVolume: config.musicVolume || 0.2,
                    sfxVolume: config.sfxVolume || 0.5
                },
                transition: config.transition || 'cut', 
                transitionDuration: 1.0,
                aspectRatio: config.aspectRatio || '16:9'
            };

            const visuals = req.files.filter(f => f.fieldname === 'visualFiles');
            const audios = req.files.filter(f => f.fieldname === 'audioFiles');
            const extras = req.files.filter(f => f.fieldname === 'additionalFiles');

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
});

// NEW: Endpoint dedicated to simple merging (Video + Audio)
app.post("/api/process/start/merge", async (req, res) => {
    uploadAny(req, res, async (err) => {
        if (err) return res.status(500).json({ error: "Upload failed" });
        
        try {
            const jobId = Date.now().toString();
            jobs[jobId] = { progress: 1, status: "processing" };
            
            const files = req.files;
            if (!files || files.length < 2) throw new Error("Requires at least 2 files (video + audio)");
            
            const videoFile = files.find(f => f.mimetype.startsWith('video')) || files[0];
            const audioFile = files.find(f => f.mimetype.startsWith('audio')) || files[1];
            
            const vPath = path.join(UPLOAD_DIR, videoFile.filename);
            const aPath = path.join(UPLOAD_DIR, audioFile.filename);
            const outPath = path.join(OUTPUT_DIR, `merged_${jobId}.mp4`);
            
            // FFMPEG Merge: video stream copy (if possible) or re-encode, replace audio
            // Use shortest to cut audio to video length or stream_loop for video
            const args = [
                "-y",
                "-i", vPath,
                "-i", aPath,
                "-c:v", "copy", // Try copy first for speed
                "-c:a", "aac",
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-shortest", // Stop when shortest input ends (usually video)
                outPath
            ];
            
            // If copy fails or format mismatch, might need re-encode, but copy is safe for mp4/aac usually.
            // If video is image (which shouldn't happen here usually but safety check):
            if (videoFile.mimetype.startsWith('image')) {
                 // Image + Audio merge
                 // We need to know duration or loop image
                 const dur = await getExactDuration(aPath) || 10;
                 args.splice(3, 2); // remove -c:v copy
                 args.splice(1, 0, "-loop", "1"); // add loop 1 before input 0
                 args.push("-t", dur.toString(), ...getVideoArgs());
            }

            runFFmpeg(args)
                .then(() => {
                    jobs[jobId].status = "completed";
                    jobs[jobId].downloadUrl = `/outputs/${path.basename(outPath)}`;
                    jobs[jobId].progress = 100;
                })
                .catch(e => {
                    jobs[jobId].status = "failed";
                    jobs[jobId].error = e.toString();
                });

            res.json({ jobId });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

app.post("/api/process/start/:action", async (req, res) => {
    uploadAny(req, res, async (err) => {
        if (err) return res.status(500).json({ error: "Upload failed" });
        const jobId = Date.now().toString();
        // Placeholder for other audio processing
        const files = req.files || [];
        if (files.length > 0) {
            jobs[jobId] = { 
                status: "completed", 
                progress: 100, 
                downloadUrl: `/uploads/${files[0].filename}` 
            };
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
            jobs[jobId] = { 
                status: "completed", 
                progress: 100, 
                downloadUrl: `/uploads/${files[0].filename}` 
            };
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
