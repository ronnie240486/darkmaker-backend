
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
//      AUDIO CHECK
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
        'cut':'fade',
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
        if (fs.existsSync('index.html')) fs.copyFileSync('index.html', path.join(PUBLIC_DIR,'index.html'));
        if (fs.existsSync('index.css')) fs.copyFileSync('index.css', path.join(PUBLIC_DIR,'index.css'));

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

// multer
const storage = multer.diskStorage({
    destination:(req,file,cb)=>cb(null,UPLOAD_DIR),
    filename:(req,file,cb)=>cb(null, Date.now()+"-"+file.originalname.replace(/[^a-zA-Z0-9_.-]/g,"_"))
});

const uploadAny = multer({storage}).any();

// JOBS
const jobs = {};

// ============================================================================
//                           RENDER ENGINE
// ============================================================================

async function renderVideoProject(project, jobId) {
    const sessionDir = path.join(OUTPUT_DIR, `job_${jobId}`);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const tempClips = [];
    const durations = [];

    // -----------------------------------------------
    // PROCESSA CADA CLIP (VIDEO + AUDIO)
    // -----------------------------------------------
    for (let i = 0; i < project.clips.length; i++) {
        const clip = project.clips[i];
        const inputPath = path.join(UPLOAD_DIR, clip.file);
        
        // Determine Duration
        let duration = clip.duration || 5;
        if (duration <= 0) duration = 5;

        durations.push(duration);

        // Movement
        const movementFilter = getMovementFilter(clip.movement || "kenburns", duration);
        const outFile = path.join(sessionDir, `clip_${i}.mp4`);
        tempClips.push(outFile);

        const args = ["-y"];
        let filterComplex = "";
        
        // Inputs
        // 0: Video/Image
        if (clip.file.match(/\.(mp4|mov|webm)$/i)) {
             args.push("-stream_loop", "-1", "-i", inputPath);
        } else {
             args.push("-loop", "1", "-i", inputPath);
        }

        // 1: Audio (Optional)
        let hasAudio = false;
        if (clip.audio) {
            const audioPath = path.join(UPLOAD_DIR, clip.audio);
            if (fs.existsSync(audioPath)) {
                args.push("-i", audioPath);
                hasAudio = true;
            }
        }

        // Filters
        // [0:v] -> Movement -> [v_out]
        filterComplex += `[0:v]${movementFilter}[v_out];`;
        
        // Audio Logic: 
        // If hasAudio -> pad to duration -> [a_out]
        // If no audio -> generate silence -> [a_out]
        if (hasAudio) {
            // [1:a] -> apad -> [a_out]
            filterComplex += `[1:a]apad[a_out]`;
        } else {
            // Generate silence matching duration
            filterComplex += `anullsrc=channel_layout=stereo:sample_rate=44100:d=${duration}[a_out]`;
        }

        args.push(
            "-filter_complex", filterComplex,
            "-map", "[v_out]",
            "-map", "[a_out]",
            "-t", duration.toString(),
            ...getVideoArgs(),
            ...getAudioArgs(), // Ensure AAC Audio
            outFile
        );

        await runFFmpeg(args);
        jobs[jobId].progress = Math.floor((i / project.clips.length) * 45);
    }

    // -----------------------------------------------
    //   XFADES (CONCAT WITH TRANSITIONS)
    // -----------------------------------------------
    const inputArgs = [];
    tempClips.forEach(path => inputArgs.push("-i", path));

    let filterGraph = "";
    let prevLabelV = "[0:v]";
    let prevLabelA = "[0:a]";
    let outIndex = 0;

    const trDur = project.transitionDuration || 1.0;
    const trType = getTransitionXfade(project.transition || "fade");

    let timeCursor = durations[0];

    for (let i = 1; i < tempClips.length; i++) {
        const offset = timeCursor - trDur;
        const outLabelV = `[v${outIndex + 1}]`;
        const outLabelA = `[a${outIndex + 1}]`;

        // Video Xfade
        filterGraph += `${prevLabelV}[${i}:v]xfade=transition=${trType}:duration=${trDur}:offset=${offset}${outLabelV};`;
        
        // Audio Acrossfade
        filterGraph += `${prevLabelA}[${i}:a]acrossfade=d=${trDur}:c1=tri:c2=tri${outLabelA};`;

        prevLabelV = outLabelV;
        prevLabelA = outLabelA;
        outIndex++;

        timeCursor += (durations[i] - trDur);
    }

    const concatOut = path.join(sessionDir, "video_final.mp4");

    // Note: If only 1 clip, handle gracefully
    if (tempClips.length === 1) {
        fs.copyFileSync(tempClips[0], concatOut);
    } else {
        const concatArgs = [
            "-y",
            ...inputArgs,
            "-filter_complex", filterGraph,
            "-map", prevLabelV,
            "-map", prevLabelA,
            ...getVideoArgs(),
            ...getAudioArgs(),
            concatOut,
        ];
        await runFFmpeg(concatArgs);
    }
    
    jobs[jobId].progress = 70;

    // -----------------------------------------------
    //   GLOBAL AUDIO MIXING (BGM / SFX Overlays)
    // -----------------------------------------------
    const bgm = project.audio?.bgm ? path.join(UPLOAD_DIR, project.audio.bgm) : null;
    
    // We already have voice/scene audio in concatOut. We just need to ADD BGM if exists.
    let finalOutput = path.join(OUTPUT_DIR, `video_${jobId}.mp4`);

    if (bgm && fs.existsSync(bgm)) {
        const mixGraph = `[1:a]aloop=loop=-1:size=2e+09,volume=${project.audio.bgmVolume ?? 0.2}[bgm];[0:a][bgm]amix=inputs=2:duration=first[a_final]`;
        
        await runFFmpeg([
            "-y",
            "-i", concatOut,
            "-i", bgm,
            "-filter_complex", mixGraph,
            "-map", "0:v",
            "-map", "[a_final]",
            ...getVideoArgs(),
            ...getAudioArgs(),
            finalOutput
        ]);
    } else {
        // Just copy/move if no extra audio layers
        fs.copyFileSync(concatOut, finalOutput);
    }

    jobs[jobId].progress = 100;
    return finalOutput;
}

// ============================================================================
//   FFmpeg CALL
// ============================================================================
function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const ff = spawn(ffmpegPath, args);
        ff.on("close", code => {
            if (code === 0) resolve();
            else reject("FFmpeg error " + code);
        });
    });
}

// ============================================================================
//                               ROUTES
// ============================================================================

// UPLOAD
app.post("/api/upload", (req, res) => {
    uploadAny(req, res, (err) => {
        if (err) return res.status(500).json({ error: "Falha no upload", details: err });
        res.json({ files: req.files });
    });
});

// RENDER (Mappings for VideoTurbo)
app.post("/api/render", async (req, res) => {
    uploadAny(req, res, async (err) => {
        if (err) return res.status(500).json({ error: "Upload failed" });

        try {
            const jobId = Date.now().toString();
            jobs[jobId] = { progress: 1, status: "processing" };

            // Parse Config sent by VideoTurbo
            let config = {};
            if (req.body.config) {
                try { config = JSON.parse(req.body.config); } catch(e) {}
            }

            // Construct Project Object
            const project = {
                clips: [],
                audio: {
                    bgm: null,
                    bgmVolume: config.musicVolume || 0.2,
                    sfxVolume: config.sfxVolume || 0.5
                },
                transition: config.transition || 'fade',
                transitionDuration: 1.0
            };

            // Files from Multer
            const visuals = req.files.filter(f => f.fieldname === 'visualFiles');
            const audios = req.files.filter(f => f.fieldname === 'audioFiles');
            const extras = req.files.filter(f => f.fieldname === 'additionalFiles');

            // Find BGM
            const bgmFile = extras.find(f => f.originalname.includes('background_music'));
            if (bgmFile) project.audio.bgm = bgmFile.filename;

            // Map Clips
            for (let i = 0; i < visuals.length; i++) {
                const vFile = visuals[i];
                const aFile = audios[i]; // Corresponding audio/silence for this scene
                const meta = config.sceneData ? config.sceneData[i] : {};

                project.clips.push({
                    file: vFile.filename,
                    audio: aFile ? aFile.filename : null,
                    duration: parseFloat(meta.duration) || 5,
                    movement: config.movement || 'kenburns'
                });
            }

            // Start Render
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

// STATUS
app.get("/api/process/status/:id", (req, res) => {
    const job = jobs[req.params.id];
    if (!job) return res.status(404).json({ status: "not_found" });
    res.json(job);
});

// DOWNLOAD
app.get("/api/download/:file", (req, res) => {
    const filePath = path.join(OUTPUT_DIR, req.params.file);
    if (!fs.existsSync(filePath)) return res.status(404).send("Arquivo não encontrado.");
    res.download(filePath);
});

// SERVER START
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Turbo Server Running on Port ${PORT}`);
});
