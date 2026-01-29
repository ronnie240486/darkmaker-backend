
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

// IMPORTAÇÃO DOS PRESETS
import { getMovementFilter } from './presets/movements.js';
import { buildTransitionFilter, getTransitionXfade } from './presets/transitions.js';
import { getFFmpegFilterFromEffect } from './presets/effects.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

[UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// TURBO ARGS: 24fps, ultrafast, zerolatency (inicia instantâneo)
const getVideoArgs = () => [
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline', 
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-r', '24' 
];

const getAudioArgs = () => [
    '-c:a', 'aac',
    '-b:a', '128k', 
    '-ar', '44100'
];

// PROBE: Obtém a duração exata do arquivo de mídia no disco
const getExactDuration = (filePath) => {
    return new Promise((resolve) => {
        execFile(ffprobePath.path, [
            '-v', 'error', 
            '-show_entries', 'format=duration', 
            '-of', 'default=noprint_wrappers=1:nokey=1', 
            filePath
        ], (err, stdout) => {
            if (err) {
                console.error("Erro no probe:", err);
                resolve(0);
            } else {
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
    } catch (e) { console.error(e); }
}
await buildFrontend();

app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/outputs', express.static(OUTPUT_DIR));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9_.]/g, '_')}`)
});
const uploadAny = multer({ storage }).any();

const jobs = {};

// --- VIDEO TOOLS LOGIC (17 FERRAMENTAS) ---
function getToolCommand(action, inputFiles, params, outputPath) {
    const input = inputFiles[0]?.path;
    const args = [];

    // Base inputs
    if (action !== 'join') {
        args.push('-i', input);
    }

    switch (action) {
        case 'upscale':
            const targetRes = params.upscaleTarget === '4k' ? '3840:2160' : params.upscaleTarget === '2k' ? '2560:1440' : '1920:1080';
            // Usa Lanczos para upscale de alta qualidade e unsharp mask para nitidez
            args.push('-vf', `scale=${targetRes}:flags=lanczos,unsharp=5:5:1.0:5:5:0.0`, '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-c:a', 'copy');
            break;

        case 'interpolation':
            const fps = params.targetFps || '60';
            const slowMo = params.slowMo === 'true';
            // Usa minterpolate para gerar frames intermediários (Optical Flow via CPU)
            const filter = `minterpolate='mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:fps=${fps}'`;
            if (slowMo) {
                args.push('-vf', `${filter},setpts=2.0*PTS`, '-r', fps, '-c:v', 'libx264', '-preset', 'medium');
            } else {
                args.push('-vf', filter, '-r', fps, '-c:v', 'libx264', '-preset', 'medium');
            }
            break;

        case 'colorize':
            const style = params.style || 'realistic';
            let colorFilter = "";
            if (style === 'vintage') colorFilter = "colorbalance=rs=0.2:bs=-0.2,eq=gamma=1.2:saturation=0.8";
            else if (style === 'vibrant') colorFilter = "eq=contrast=1.1:saturation=1.5";
            else colorFilter = "eq=saturation=1.1,colorbalance=rm=0.1:gm=0.05:bm=-0.1"; // Tentativa de realismo
            args.push('-vf', colorFilter, '-c:v', 'libx264', '-c:a', 'copy');
            break;

        case 'stabilize':
            // Deshake filter (estabilização single-pass simples no ffmpeg)
            args.push('-vf', 'deshake', '-c:v', 'libx264', '-preset', 'medium', '-c:a', 'copy');
            break;

        case 'motion-blur':
            const shutter = params.shutter || '180';
            // Simula motion blur misturando frames (tblend) ou minterpolate
            args.push('-vf', `minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:shutter_angle=${shutter}`, '-c:v', 'libx264', '-preset', 'medium');
            break;

        case 'clean-video':
            // Denoise filters
            const strength = params.strength === 'high' ? '6.0' : params.strength === 'low' ? '2.0' : '4.0';
            args.push('-vf', `hqdn3d=${strength}:${strength}:3.0:3.0`, '-c:v', 'libx264', '-preset', 'medium', '-c:a', 'copy');
            break;

        case 'cut':
            const start = params.start || '0';
            const end = params.end;
            args.push('-ss', start);
            if (end) args.push('-to', end);
            args.push('-c', 'copy'); // Fast cut
            break;

        case 'join':
            // Cria arquivo de lista para concatenação
            const listPath = path.join(path.dirname(inputFiles[0].path), `join_list_${Date.now()}.txt`);
            const fileLines = inputFiles.map(f => `file '${f.path}'`).join('\n');
            fs.writeFileSync(listPath, fileLines);
            
            // Concat demuxer (rápido, mas requer formatos iguais)
            // Se falhar, poderia usar filter_complex concat, mas assumimos formatos similares
            args.push('-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy');
            break;

        case 'compress':
            const crf = params.crf || '28';
            args.push('-c:v', 'libx264', '-crf', crf, '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k');
            break;

        case 'convert':
            // Formato é definido pela extensão de saída, args genéricos de compatibilidade
            args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac');
            break;

        case 'reverse':
            // Reverte vídeo e áudio
            args.push('-vf', 'reverse', '-af', 'areverse', '-c:v', 'libx264', '-preset', 'medium');
            break;

        case 'speed':
            const speed = parseFloat(params.speed || '1.0');
            const setpts = (1 / speed).toFixed(4);
            const atempo = speed;
            
            // Filtro de áudio atempo suporta 0.5 a 2.0. Para valores maiores, encadear.
            let aFilter = `atempo=${atempo}`;
            if (speed > 2.0) aFilter = `atempo=2.0,atempo=${(speed/2).toFixed(2)}`;
            if (speed < 0.5) aFilter = `atempo=0.5,atempo=${(speed*2).toFixed(2)}`;

            args.push('-filter_complex', `[0:v]setpts=${setpts}*PTS[v];[0:a]${aFilter}[a]`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264');
            break;

        case 'resize':
            const ratio = params.ratio || '16:9';
            let scaleFilter = "scale=1280:720";
            if (ratio === '9:16') scaleFilter = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280";
            if (ratio === '1:1') scaleFilter = "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080";
            if (ratio === '4:3') scaleFilter = "scale=1024:768:force_original_aspect_ratio=increase,crop=1024:768";
            
            args.push('-vf', scaleFilter, '-c:v', 'libx264', '-c:a', 'copy');
            break;

        case 'watermark':
            const text = params.text || "Watermark";
            const pos = params.position || "bottom-right";
            let posExp = "x=w-tw-10:y=h-th-10"; // bottom-right default
            if (pos === 'bottom-left') posExp = "x=10:y=h-th-10";
            if (pos === 'top-right') posExp = "x=w-tw-10:y=10";
            if (pos === 'center') posExp = "x=(w-text_w)/2:y=(h-text_h)/2";
            
            args.push('-vf', `drawtext=text='${text}':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.5:boxborderw=5:${posExp}`, '-c:v', 'libx264', '-c:a', 'copy');
            break;

        case 'gif':
            const gifW = params.width || '480';
            const gifFps = params.fps || '15';
            // Paleta otimizada para GIF de alta qualidade
            args.push('-vf', `fps=${gifFps},scale=${gifW}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`);
            break;

        case 'remove-audio':
            args.push('-c:v', 'copy', '-an');
            break;

        case 'extract-audio':
            args.push('-vn', '-c:a', 'libmp3lame', '-q:a', '2');
            break;

        default: // Fallback copy
            args.push('-c', 'copy');
    }

    // Output filename push
    args.push(outputPath);
    return args;
}

// --- SUBTITLE STYLES ENGINE ---
const C = {
    Yellow: '&H0000FFFF', Green: '&H0000FF00', Red: '&H000000FF', Cyan: '&H00FFFF00',
    White: '&H00FFFFFF', Black: '&H00000000', Orange: '&H0000A5FF', Pink: '&H009314FF',
    Purple: '&H00800080', Blue: '&H00FF0000', Gold: '&H0000D7FF', Grey: '&H00E0E0E0',
    Lime: '&H0000FF80', Magenta: '&H00FF00FF', Teal: '&H00808000', Navy: '&H00800000',
    Maroon: '&H00000080', Olive: '&H00008080', Silver: '&H00C0C0C0', Aqua: '&H00FFFF00'
};

const FONTS = {
    Impact: 'Impact', Arial: 'Arial', Verdana: 'Verdana', 
    Helvetica: 'Helvetica', Times: 'Times New Roman', Courier: 'Courier New',
    Comic: 'Comic Sans MS', Tahoma: 'Tahoma', Georgia: 'Georgia', Trebuchet: 'Trebuchet MS'
};

const BASE = "FontSize=24,Bold=1,Alignment=2,MarginV=50";

const genStyle = (name, font, primary, outline, back, borderStyle = 1, shadow = 0) => {
    return `Fontname=${font},${BASE},PrimaryColour=${primary},OutlineColour=${outline},BackColour=${back},BorderStyle=${borderStyle},Outline=${borderStyle === 3 ? 0 : 2},Shadow=${shadow}`;
};

const SUBTITLE_STYLES = {};

const viralColors = Object.entries(C);
viralColors.forEach(([name, color]) => {
    SUBTITLE_STYLES[`viral_${name.toLowerCase()}`] = genStyle(`Viral ${name}`, FONTS.Impact, color, C.Black, C.Black, 1, 0);
});
viralColors.forEach(([name, color]) => {
    SUBTITLE_STYLES[`clean_${name.toLowerCase()}`] = genStyle(`Clean ${name}`, FONTS.Arial, color, C.Black, C.Black, 1, 1);
});
viralColors.forEach(([name, color]) => {
    SUBTITLE_STYLES[`box_${name.toLowerCase()}`] = genStyle(`Box ${name}`, FONTS.Verdana, color, C.Black, '&H80000000', 3, 0);
});
const neonPairs = [['Cyan', C.Blue], ['Pink', C.Purple], ['Green', C.Lime], ['Yellow', C.Orange], ['White', C.Cyan]];
neonPairs.forEach(([name, outline], idx) => {
    SUBTITLE_STYLES[`neon_${name.toLowerCase()}`] = `Fontname=Verdana,${BASE},PrimaryColour=${C[name]},OutlineColour=${outline},BorderStyle=1,Outline=2,Shadow=2`;
    SUBTITLE_STYLES[`neon_bold_${name.toLowerCase()}`] = `Fontname=Impact,${BASE},PrimaryColour=${C[name]},OutlineColour=${outline},BorderStyle=1,Outline=3,Shadow=0`;
    SUBTITLE_STYLES[`neon_light_${name.toLowerCase()}`] = `Fontname=Arial,${BASE},PrimaryColour=${C[name]},OutlineColour=${outline},BorderStyle=1,Outline=1,Shadow=4`;
});
SUBTITLE_STYLES['cine_gold'] = genStyle('Cine Gold', FONTS.Times, C.Gold, C.Black, C.Black, 1, 1);
SUBTITLE_STYLES['cine_white'] = genStyle('Cine White', FONTS.Times, C.White, '&H40000000', C.Black, 1, 1);
SUBTITLE_STYLES['cine_silver'] = genStyle('Cine Silver', FONTS.Times, C.Silver, C.Black, C.Black, 1, 1);
SUBTITLE_STYLES['cine_classic'] = `Fontname=Georgia,${BASE},PrimaryColour=${C.White},OutlineColour=${C.Black},BorderStyle=1,Outline=1,Shadow=1,Italic=1`;
SUBTITLE_STYLES['retro_green'] = genStyle('Retro Green', FONTS.Courier, C.Green, C.Black, '&H80000000', 3, 0);
SUBTITLE_STYLES['retro_amber'] = genStyle('Retro Amber', FONTS.Courier, C.Orange, C.Black, '&H80000000', 3, 0);
SUBTITLE_STYLES['retro_white'] = genStyle('Retro White', FONTS.Courier, C.White, C.Black, '&H80000000', 3, 0);
SUBTITLE_STYLES['comic_yellow'] = genStyle('Comic Yellow', FONTS.Comic, C.Yellow, C.Black, C.Black, 1, 2);
SUBTITLE_STYLES['comic_white'] = genStyle('Comic White', FONTS.Comic, C.White, C.Black, C.Black, 1, 2);
SUBTITLE_STYLES['comic_cyan'] = genStyle('Comic Cyan', FONTS.Comic, C.Cyan, C.Blue, C.Black, 1, 0);
SUBTITLE_STYLES['viral_yellow'] = SUBTITLE_STYLES['viral_yellow'] || genStyle('Viral Yellow', FONTS.Impact, C.Yellow, C.Black, C.Black, 1, 0);

function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return (parseFloat(parts[0]) * 3600) + (parseFloat(parts[1]) * 60) + parseFloat(parts[2]);
}

function formatSrtTime(seconds) {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const iso = date.toISOString();
    return iso.substr(11, 8) + ',' + iso.substr(20, 3);
}

function createFFmpegJob(jobId, args, expectedDuration, res) {
    jobs[jobId].status = 'processing';
    if (res && !res.headersSent) res.status(202).json({ jobId });
    
    console.log(`[JOB ${jobId}] Spawning FFmpeg: ${args.join(' ')}`);
    const ffmpeg = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-stats', '-y', ...args]);
    
    ffmpeg.stderr.on('data', d => {
        const line = d.toString();
        // Log progress slightly
        if(line.includes('time=')) {
             const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
             if (timeMatch && expectedDuration > 0) {
                const cur = timeToSeconds(timeMatch[1]);
                let p = Math.round((cur / expectedDuration) * 100);
                if (p > 100) p = 99;
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
            console.error(`FFmpeg failed with code ${code}`);
            jobs[jobId].status = 'failed';
            jobs[jobId].error = 'FFmpeg processing failed';
        }
    });
}

// Handler para Video Turbo / Shorts / Magic Workflow
async function handleExport(job, uploadDir, callback) {
    const outputName = `render_${job.id}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    
    const transition = job.params?.transition || 'cut'; 
    const movement = job.params?.movement || 'static';
    const renderSubtitles = job.params?.renderSubtitles === 'true';
    const subtitleStyleKey = job.params?.subtitleStyle || 'viral_yellow';
    const aspectRatio = job.params?.aspectRatio || '16:9';
    
    let musicVolume = parseFloat(job.params?.musicVolume);
    if (isNaN(musicVolume)) musicVolume = 0.2;
    
    let sfxVolume = parseFloat(job.params?.sfxVolume);
    if (isNaN(sfxVolume)) sfxVolume = 0.5;

    let targetW = 1280;
    let targetH = 720;
    if (aspectRatio === '9:16') {
        targetW = 720;
        targetH = 1280;
    }

    let scenesData = [];
    try { if (job.params?.scenesData) scenesData = JSON.parse(job.params.scenesData); } catch(e) {}

    try {
        const sceneMap = {};
        let bgMusicFile = null;

        job.files.forEach(f => {
            if (f.originalname.includes('background_music')) {
                bgMusicFile = f;
            } else {
                const match = f.originalname.match(/scene_(\d+)_(visual|audio|sfx)/);
                if (match) {
                    const idx = parseInt(match[1]);
                    const type = match[2];
                    if (!sceneMap[idx]) sceneMap[idx] = {};
                    sceneMap[idx][type] = f;
                }
            }
        });

        const sortedScenes = Object.keys(sceneMap).sort((a,b) => a - b).map(k => sceneMap[k]);
        const clipPaths = [];
        const tempFiles = [];
        const videoClipDurations = []; 

        const transitionDuration = transition === 'cut' ? 0 : 1.0;
        const padding = transition === 'cut' ? 0 : transitionDuration; 

        // PASSO 1: GERAR CLIPES INDIVIDUAIS
        for (let i = 0; i < sortedScenes.length; i++) {
            const scene = sortedScenes[i];
            
            if(jobs[job.id]) {
                const percentPerScene = 75 / sortedScenes.length;
                jobs[job.id].progress = Math.floor(5 + (i * percentPerScene));
            }

            const clipPath = path.join(uploadDir, `temp_clip_${job.id}_${i}.mp4`);
            const args = [];
            
            let exactAudioDuration = scenesData[i]?.duration || 5;
            
            if (scene.audio) {
                const probeDur = await getExactDuration(scene.audio.path);
                if (probeDur > 0) exactAudioDuration = probeDur + 0.5; 
            }

            const totalClipDuration = padding + exactAudioDuration + padding;
            videoClipDurations.push(totalClipDuration);

            const moveFilter = getMovementFilter(movement, totalClipDuration + 2.0, targetW, targetH);
            const delayMs = Math.floor(padding * 1000);
            
            // Mixagem SFX + Voz
            if (scene.visual) {
                if (scene.visual.mimetype.includes('image')) {
                    args.push('-framerate', '24', '-loop', '1', '-i', scene.visual.path);
                } else {
                    args.push('-stream_loop', '-1', '-i', scene.visual.path);
                }
                
                if (scene.audio) {
                    args.push('-i', scene.audio.path);
                } else {
                    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
                }

                if (scene.sfx) {
                    args.push('-i', scene.sfx.path);
                    const mixFilter = `[1:a]volume=1.5[voice];[2:a]volume=${sfxVolume}[sfx];[voice][sfx]amix=inputs=2:duration=first:dropout_transition=2,adelay=${delayMs}|${delayMs},apad`;
                    
                    if (scene.visual.mimetype.includes('image')) {
                         args.push('-vf', moveFilter, '-filter_complex', mixFilter, '-t', totalClipDuration.toFixed(3), ...getVideoArgs(), ...getAudioArgs(), '-ac', '2', clipPath);
                    } else {
                         args.push('-map', '0:v', '-filter_complex', `${mixFilter};[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,fps=24,format=yuv420p`, '-t', totalClipDuration.toFixed(3), ...getVideoArgs(), ...getAudioArgs(), clipPath);
                    }
                } else {
                    const audioFilter = delayMs > 0 ? `volume=1.5,adelay=${delayMs}|${delayMs},apad` : 'volume=1.5,apad';
                    if (scene.visual.mimetype.includes('image')) {
                        args.push('-vf', moveFilter, '-af', audioFilter, '-t', totalClipDuration.toFixed(3), ...getVideoArgs(), ...getAudioArgs(), '-ac', '2', clipPath);
                    } else {
                        args.push('-map', '0:v', '-map', '1:a', '-vf', `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,fps=24,format=yuv420p`, '-af', audioFilter, '-t', totalClipDuration.toFixed(3), ...getVideoArgs(), ...getAudioArgs(), clipPath);
                    }
                }
            }
            
            // Execute FFmpeg for clip
            await new Promise((resolve, reject) => {
                const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
                proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Clip ${i} failed`)));
            });
            
            clipPaths.push(clipPath);
            tempFiles.push(clipPath);
        }

        // PASSO 2: LEGENDAS
        let srtPath = "";
        let forceStyle = SUBTITLE_STYLES[subtitleStyleKey] || SUBTITLE_STYLES['viral_yellow'];

        if (renderSubtitles && scenesData.length > 0) {
            let srtContent = "";
            let globalTimelineCursor = 0; 
            
            for(let idx = 0; idx < scenesData.length; idx++) {
                const sd = scenesData[idx];
                const realAudioDuration = videoClipDurations[idx] - (padding * 2); 
                
                if (sd.narration) {
                    const startTime = globalTimelineCursor + padding;
                    const endTime = startTime + realAudioDuration - 0.5; 
                    srtContent += `${idx + 1}\n${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}\n${sd.narration}\n\n`;
                }
                
                globalTimelineCursor += (videoClipDurations[idx] - transitionDuration);
            }
            
            srtPath = path.join(uploadDir, `subs_${job.id}.srt`);
            fs.writeFileSync(srtPath, srtContent);
            tempFiles.push(srtPath);
        }

        // PASSO 3: CONCATENAÇÃO FINAL
        if(jobs[job.id]) jobs[job.id].progress = 80;

        let finalArgs = [];
        const absoluteSrtPath = srtPath ? path.resolve(srtPath).split(path.sep).join('/').replace(/:/g, '\\:') : "";
        const hasBgMusic = !!bgMusicFile;

        if (transition === 'cut' || clipPaths.length === 1) {
            const listPath = path.join(uploadDir, `concat_list_${job.id}.txt`);
            fs.writeFileSync(listPath, clipPaths.map(p => `file '${path.resolve(p).split(path.sep).join('/')}'`).join('\n'));
            tempFiles.push(listPath);

            const filters = [];
            let baseArgs = ['-f', 'concat', '-safe', '0', '-i', listPath];
            if (hasBgMusic) baseArgs.push('-i', bgMusicFile.path);

            if (renderSubtitles && srtPath) {
                filters.push(`[0:v]subtitles='${absoluteSrtPath}':force_style='${forceStyle}'[v_sub]`);
            } else {
                filters.push(`[0:v]null[v_sub]`);
            }

            if (hasBgMusic) {
                filters.push(`[1:a]volume=${musicVolume}[bgm];[0:a][bgm]amix=inputs=2:duration=first[a_out]`);
                finalArgs = [...baseArgs, '-filter_complex', filters.join(';'), '-map', '[v_sub]', '-map', '[a_out]', ...getVideoArgs(), ...getAudioArgs(), outputPath];
            } else {
                finalArgs = [
                    '-f', 'concat', '-safe', '0', '-i', listPath, 
                    '-vf', renderSubtitles && srtPath ? `subtitles='${absoluteSrtPath}':force_style='${forceStyle}'` : 'null', 
                    ...getVideoArgs(), ...getAudioArgs(), outputPath
                ];
            }

        } else {
            const inputs = []; 
            clipPaths.forEach(p => inputs.push('-i', p));
            if (hasBgMusic) inputs.push('-i', bgMusicFile.path);
            
            let { filterComplex, mapArgs } = buildTransitionFilter(clipPaths.length, transition, videoClipDurations, transitionDuration);
            
            const lastVLabel = mapArgs[1]; 
            const lastALabel = mapArgs[3]; 
            
            let finalVLabel = lastVLabel;
            let finalALabel = lastALabel;

            if (renderSubtitles && srtPath) {
                const subLabel = `[v_subs]`;
                filterComplex += `;${lastVLabel}subtitles='${absoluteSrtPath}':force_style='${forceStyle}'${subLabel}`;
                finalVLabel = subLabel;
            }

            if (hasBgMusic) {
                const bgmIndex = clipPaths.length; 
                const mixedLabel = `[a_mixed]`;
                filterComplex += `;[${bgmIndex}:a]volume=${musicVolume}[bgm];${lastALabel}[bgm]amix=inputs=2:duration=first${mixedLabel}`;
                finalALabel = mixedLabel;
            }
            
            finalArgs = [...inputs, '-filter_complex', filterComplex, '-map', finalVLabel, '-map', finalALabel, ...getVideoArgs(), ...getAudioArgs(), outputPath];
        }

        const totalEstimated = scenesData.reduce((acc, s) => acc + (s.duration || 5), 0);
        callback(job.id, finalArgs, totalEstimated);
        
        setTimeout(() => tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f)), 300000); 
    } catch (e) { 
        console.error("ERRO NO EXPORT:", e); 
        if (jobs[job.id]) {
            jobs[job.id].status = 'failed'; 
            jobs[job.id].error = e.message; 
        }
    }
}

app.post('/api/process/start/:action', uploadAny, (req, res) => {
    const action = req.params.action;
    const jobId = `${action}_${Date.now()}`;
    const outputName = `processed_${jobId}.${action === 'extract-audio' ? 'mp3' : action === 'gif' ? 'gif' : 'mp4'}`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    
    jobs[jobId] = { id: jobId, status: 'pending', progress: 0, files: req.files, params: req.body, downloadUrl: null };
    
    // Construct specific tool command
    try {
        const args = getToolCommand(action, req.files, req.body, outputPath);
        // Estimate 30s processing for generic tools if not specified
        createFFmpegJob(jobId, args, 30, res);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
        jobs[jobId].status = 'failed';
    }
});

app.post('/api/export/start', uploadAny, (req, res) => {
    const jobId = `export_${Date.now()}`;
    jobs[jobId] = { id: jobId, status: 'processing', progress: 5, files: req.files, params: req.body, downloadUrl: null };
    res.status(202).json({ jobId });
    handleExport(jobs[jobId], UPLOAD_DIR, (id, args, dur) => createFFmpegJob(id, args, dur, null));
});

app.get('/api/process/status/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job) return res.status(404).json({ status: 'not_found' });
    res.json(job);
});

app.get('/api/process/download/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (job && job.downloadUrl) return res.redirect(job.downloadUrl);
    res.status(404).send("File not found");
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server online on port ${PORT}`));
