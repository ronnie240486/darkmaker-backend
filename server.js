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
            resolve(stdout.toString().trim().length > 0);
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
        'kenburns': `zoompan=z='1.0+(0.3*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
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
    '-preset','medium',
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
            minify:true
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
    const concatListPath = path.join(sessionDir, "concat.txt");

    // -----------------------------------------------
    // PROCESSA CADA CLIP INDIVIDUALMENTE
    // -----------------------------------------------
    for (let i = 0; i < project.clips.length; i++) {
        const clip = project.clips[i];

        const inputPath = clip.file ? path.join(UPLOAD_DIR, clip.file) : null;
        const duration = clip.duration || await getExactDuration(inputPath);
        const movementFilter = getMovementFilter(clip.movement || 'kenburns', duration);

        const outFile = path.join(sessionDir, `clip_${i}.mp4`);
        tempClips.push(outFile);

        const args = [
            "-y",
            "-loop", "1",
            "-i", inputPath,
            "-t", duration.toString(),
            "-filter_complex", movementFilter,
            ...getVideoArgs(),
            "-an",
            outFile
        ];

        await runFFmpeg(args);
        jobs[jobId].progress = Math.floor((i / project.clips.length) * 50);
    }

    // -----------------------------------------------
    //   CONCATENAÇÃO COM XFADES
    // -----------------------------------------------
    let filterGraph = "";
    let inputArgs = [];
    let inputCount = 0;

    tempClips.forEach((clipPath, idx) => {
        inputArgs.push("-i", clipPath);
        inputCount++;
    });

    let filterIndex = 0;
    let prev = "[0:v]";

    for (let i = 1; i < inputCount; i++) {
        const tr = getTransitionXfade(project.transition || 'fade');

        const outLabel = `[v${filterIndex + 1}]`;

        filterGraph += `
            ${prev} [${i}:v] xfade=transition=${tr}:duration=${project.transitionDuration || 1}:offset=${i * (project.transitionDuration || 1)} ${outLabel};
        `;

        prev = outLabel;
        filterIndex++;
    }

    const concatOut = path.join(sessionDir, "video_final.mp4");

    const concatArgs = [
        "-y",
        ...inputArgs,
        "-filter_complex", filterGraph,
        "-map", prev,
        ...getVideoArgs(),
        "-an",
        concatOut
    ];

    await runFFmpeg(concatArgs);
    jobs[jobId].progress = 70;

    // -----------------------------------------------
    //   ÁUDIO FINAL (VOICE + SFX + BGM)
    // -----------------------------------------------
    const voice = project.audio?.voiceover ? path.join(UPLOAD_DIR, project.audio.voiceover) : null;
    const sfx = project.audio?.sfx ? path.join(UPLOAD_DIR, project.audio.sfx) : null;
    const bgm = project.audio?.bgm ? path.join(UPLOAD_DIR, project.audio.bgm) : null;

    const streams = [];
    const filters = [];
    let idx = 0;

    // --- VOICE ---
    if (voice && fs.existsSync(voice) && await fileHasAudio(voice)) {
        streams.push("-i", voice);
        filters.push(`[0:a]volume=${project.audio.voiceVolume ?? 1}[voice]`);
        idx++;
    }

    // --- SFX ---
    if (sfx && fs.existsSync(sfx) && await fileHasAudio(sfx)) {
        streams.push("-i", sfx);
        filters.push(`[1:a]volume=${project.audio.sfxVolume ?? 1}[sfx]`);
        idx++;
    }

    // --- BGM ---
    if (bgm && fs.existsSync(bgm) && await fileHasAudio(bgm)) {
        streams.push("-i", bgm);
        filters.push(`[2:a]volume=${project.audio.bgmVolume ?? 0.7}[bgm]`);
        idx++;
    }

    let mixOutput = path.join(sessionDir, "audio_mix.mp3");

    if (idx === 0) {
        // Nenhum áudio → cria silêncio
        await runFFmpeg([
            "-f", "lavfi",
            "-i", `anullsrc=channel_layout=stereo:sample_rate=44100`,
            "-t", project.totalDuration || 5,
            "-q:a", "3",
            mixOutput
        ]);
    } else {
        let mixInputs = "";
        let mixLabels = [];

        if (filters.length > 0) mixInputs = filters.join(";") + "; ";

        if (filters.length === 1) {
            mixInputs += filters[0].match(/\[(.*?)\]/g)[1];  
        } else {
            for (let i = 0; i < filters.length; i++) {
                const label = filters[i].match(/\[(.*?)\]/g).pop().replace(/\[|\]/g, "");
                mixLabels.push(`[${label}]`);
            }

            mixInputs += mixLabels.join("") + `amix=inputs=${filters.length}:normalize=1[aout]`;
        }

        const mixArgs = [
            "-y",
            ...streams,
            "-filter_complex",
            filters.length > 1 ? mixInputs : filters[0],
            "-map", filters.length > 1 ? "[aout]" : filters[0].match(/\[(.*?)\]/g)[1],
            ...getAudioArgs(),
            mixOutput
        ];

        await runFFmpeg(mixArgs);
    }

    jobs[jobId].progress = 85;

    // -----------------------------------------------
    //   JUNTAR VÍDEO + ÁUDIO
    // -----------------------------------------------
    const finalOutput = path.join(OUTPUT_DIR, `video_${jobId}.mp4`);

    const finalArgs = [
        "-y",
        "-i", concatOut,
        "-i", mixOutput,
        "-map", "0:v",
        "-map", "1:a",
        ...getVideoArgs(),
        ...getAudioArgs(),
        finalOutput
    ];

    await runFFmpeg(finalArgs);
    jobs[jobId].progress = 100;

    return finalOutput;
}

// ============================================================================
//   FFmpeg CALL
// ============================================================================
function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const ff = spawn(ffmpegPath, args);

        ff.stderr.on("data", data => {
            const msg = data.toString();
            // console.log(msg);
        });

        ff.on("close", code => {
            if (code === 0) resolve();
            else reject("FFmpeg error " + code);
        });
    });
}
// ============================================================================
//                               ROUTES
// ============================================================================

// ---------------------------
// UPLOAD
// ---------------------------
app.post("/api/upload", (req, res) => {
    uploadAny(req, res, (err) => {
        if (err) return res.status(500).json({ error: "Falha no upload", details: err });
        res.json({ files: req.files });
    });
});

// ---------------------------
// RENDER
// ---------------------------
app.post("/api/render", async (req, res) => {
    try {
        const project = req.body;

        const jobId = Date.now().toString();
        jobs[jobId] = { progress: 1, status: "processing" };

        renderVideoProject(project, jobId)
            .then(outputPath => {
                jobs[jobId].status = "completed";
                jobs[jobId].file = path.basename(outputPath);
            })
            .catch(err => {
                console.error("Render error:", err);
                jobs[jobId].status = "error";
            });

        res.json({ jobId });

    } catch (err) {
        console.error("API render error:", err);
        res.status(500).json({ error: "Erro ao iniciar renderização" });
    }
});

// ---------------------------
// PROGRESS
// ---------------------------
app.get("/api/progress/:id", (req, res) => {
    const job = jobs[req.params.id];
    if (!job) return res.status(404).json({ error: "Job não encontrado" });
    res.json(job);
});

// ---------------------------
// DOWNLOAD FINAL
// ---------------------------
app.get("/api/download/:file", (req, res) => {
    const filePath = path.join(OUTPUT_DIR, req.params.file);
    if (!fs.existsSync(filePath)) return res.status(404).send("Arquivo não encontrado.");
    res.download(filePath);
});

// ---------------------------
// TEST ROUTE
// ---------------------------
app.get("/api/ping", (req, res) => {
    res.json({ ok: true, time: Date.now() });
});


// ============================================================================
//                                SERVER START
// ============================================================================
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
