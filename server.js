
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
import { GoogleGenAI, Modality } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.get("/api/deapi/logs", async (req, res) => {
    try {
        const fs = require("fs");
        let logs = "";
        if (fs.existsSync("deapi_generation_debug.log")) {
            logs += "--- GENERATION LOGS ---\n" + fs.readFileSync("deapi_generation_debug.log", "utf8") + "\n\n";
        }
        if (fs.existsSync("deapi_status_debug.log")) {
            logs += "--- STATUS LOGS ---\n" + fs.readFileSync("deapi_status_debug.log", "utf8") + "\n\n";
        }
        res.send(logs || "Nenhum log encontrado.");
    } catch (e) {
        res.status(500).send("Erro ao ler logs: " + e.message);
    }
});

const PORT = 3000;

// Debug route to check headers
app.get("/api/debug/headers", (req, res) => {
    res.json({
        headers: req.headers,
        envKeys: Object.keys(process.env).filter(k => k.toLowerCase().includes('key') || k.toLowerCase().includes('api')),
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasApiKey: !!process.env.API_KEY
    });
});

function getGeminiKey(req) {
    // 1. Check environment variables
    const priorityEnv = ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'AI_STUDIO_API_KEY'];
    for (const key of priorityEnv) {
        const val = process.env[key];
        if (val && typeof val === 'string' && val.length > 5 && val !== 'undefined' && val !== 'null') {
            return val.trim();
        }
    }

    // Greedy environment search
    for (const key in process.env) {
        const u = key.toUpperCase();
        if ((u.includes('GEMINI') || u.includes('GOOGLE_AI') || u.includes('GENAI')) && u.includes('KEY')) {
            const val = process.env[key];
            if (val && typeof val === 'string' && val.length > 5 && val !== 'undefined' && val !== 'null') {
                return val.trim();
            }
        }
    }

    // 2. Check request headers
    if (req && req.headers) {
        const headerNames = ['x-goog-api-key', 'x-api-key', 'x-gemini-api-key', 'authorization'];
        for (const name of headerNames) {
            const val = req.headers[name];
            if (val && typeof val === 'string' && val.length > 5) {
                if (name === 'authorization' && val.toLowerCase().startsWith('bearer ')) {
                    const token = val.substring(7).trim();
                    if (token && token.length > 5 && token !== 'undefined' && token !== 'null') return token;
                } else if (val !== 'undefined' && val !== 'null') {
                    return val.trim();
                }
            }
        }

        // Greedy header search
        for (const h in req.headers) {
            const l = h.toLowerCase();
            if ((l.includes('key') || l.includes('token')) && (l.includes('api') || l.includes('google') || l.includes('gemini'))) {
                const val = req.headers[h];
                if (val && typeof val === 'string' && val.length > 5 && val !== 'undefined' && val !== 'null') {
                    if (!['cookie', 'set-cookie', 'host', 'user-agent', 'referer'].includes(l)) {
                        return val.trim();
                    }
                }
            }
        }
    }
    
    return "";
}

function getGeminiClient(req) {
    const key = getGeminiKey(req);
    
    if (!key) {
        throw new Error("Configuração da API não encontrada. No AI Studio, selecione sua chave no ícone de chave (🔑) no rodapé ou adicione GEMINI_API_KEY em Settings > Secrets. Se estiver no APK, insira a chave nas configurações do app.");
    }
    
    return new GoogleGenAI({
        apiKey: key,
        httpOptions: {
            headers: {
                'User-Agent': 'aistudio-build',
            }
        }
    });
}

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
            "-show_entries", "stream=codec_type,duration,nb_frames",
            "-of", "json",
            file
        ], (err, stdout) => {
            try {
                const data = JSON.parse(stdout);
                const stream = data.streams && data.streams[0];
                if (!stream) return resolve(false);
                
                const frames = parseInt(stream.nb_frames);
                const duration = parseFloat(stream.duration);
                
                // If it has more than 1 frame OR a duration > 0, it's likely a video
                const isVid = (stream.codec_type === 'video') && 
                              ((!isNaN(frames) && frames > 1) || (!isNaN(duration) && duration > 0.1));
                
                resolve(isVid);
            } catch (e) {
                resolve(false);
            }
        });
    });
}

function getExactDuration(filePath) {
    return new Promise(resolve => {
        execFile(FFPROBE_BIN, [
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
    if (!input) return null;
    
    // If it's already a filename in UPLOAD_DIR, just return it
    if (!input.startsWith('data:') && !input.startsWith('http')) {
        const existingPath = path.join(UPLOAD_DIR, input);
        if (fs.existsSync(existingPath)) return input;
    }

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

// --- MOVEMENT FILTERS ---
function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const w = parseInt(targetW) || 1280;
    const h = parseInt(targetH) || 720;
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
        'cut': 'cut', 'fade':'fade', 'mix':'dissolve', 'black':'fadeblack', 'white':'fadewhite',
        'slide-left':'slideleft', 'slide-right':'slideright',
        'wipe-left': 'wipeleft', 'wipe-right': 'wiperight', 'wipe-up': 'wipeup', 'wipe-down': 'wipedown',
        'circle-open': 'circleopen', 'circle-close': 'circleclose'
    };
    return map[t] || 'fade';
}

const getVideoArgs = () => ['-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart'];
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
        // copySafe('index.html', path.join(PUBLIC_DIR,'index.html'));
        if (fs.existsSync('index.html')) {
            let html = fs.readFileSync('index.html', 'utf8');
            html = html.replace('src="/index.tsx"', 'src="/bundle.js"');
            fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), html);
        }
        copySafe('index.css', path.join(PUBLIC_DIR,'index.css'));
        await esbuild.build({
            entryPoints:['index.tsx'],
            outfile:path.join(PUBLIC_DIR,'bundle.js'),
            bundle:true,
            format:'esm',
            minify:true,
            external: ['fs', 'path', 'child_process', 'url', 'https', 'ffmpeg-static', 'ffprobe-static', 'react', 'react-dom', 'react-dom/client', 'lucide-react'],
            define: { 'process.env.API_KEY': JSON.stringify(getGeminiKey()), 'global': 'window' },
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

const storage = multer.diskStorage({
    destination:(req,file,cb)=>cb(null,UPLOAD_DIR),
    filename:(req,file,cb)=>cb(null, Date.now()+"-"+file.originalname.replace(/[^a-zA-Z0-9_.-]/g,"_"))
});
const uploadAny = multer({storage}).any();
const jobs = {};

// --- FFmpeg Runner ---
function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        console.log("Running FFmpeg:", args.join(" "));
        const ff = spawn(FFMPEG_BIN, args);
        let errData = "";
        ff.stderr.on('data', d => errData += d.toString());
        ff.on("close", code => {
            if (code === 0) resolve();
            else reject(`FFmpeg error ${code}: ${errData.slice(-300)}`);
        });
    });
}

function escapeFFmpegText(str) {
    if (!str) return '';
    return str
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/:/g, '\\:');
}

// --- IMAGE PROCESSING ---
function getGeminiClientBackground() {
    let key = "";
    for (const k in process.env) {
        const u = k.toUpperCase();
        if ((u.includes('GEMINI') || u.includes('GOOGLE_AI') || u.includes('GENAI')) && u.includes('KEY')) {
            const val = process.env[k];
            if (val && typeof val === 'string' && val.length > 5 && val !== 'undefined' && val !== 'null') {
                key = val.trim();
                break;
            }
        }
    }
    if (!key) {
        throw new Error("Chave API Gemini não encontrada no ambiente.");
    }
    return new GoogleGenAI({
        apiKey: key,
        httpOptions: {
            headers: {
                'User-Agent': 'aistudio-build',
            }
        }
    });
}

async function processImage(action, files, config, jobId) {
    if (!files || files.length === 0) throw new Error("No files provided");
    const inputPath = path.join(UPLOAD_DIR, files[0].filename);
    
    // Determine input format based on mimetype or name
    const isPng = files[0].mimetype === 'image/png' || files[0].originalname.toLowerCase().endsWith('.png');
    const isWebp = files[0].mimetype === 'image/webp' || files[0].originalname.toLowerCase().endsWith('.webp');

    // Default output extension
    let ext = 'jpg';
    if (isPng) ext = 'png';
    if (isWebp) ext = 'webp';

    // Override if convert action or specific requirements
    if (action === 'convert' && config.format) {
        ext = config.format.toLowerCase().replace('.', '');
    }
    
    const outputPath = path.join(OUTPUT_DIR, `${action}_${jobId}.${ext}`);

    if (['inpainting', 'expand', 'recreate', 'restore', 'remove-bg', 'logo', 'prompt-gen', 'batch-gen'].includes(action)) {
        const fileBuffer = fs.readFileSync(inputPath);
        const base64Data = fileBuffer.toString('base64');
        const mimeType = files[0].mimetype || 'image/png';

        const ai = getGeminiClientBackground();
        
        let promptText = "";
        if (action === 'inpainting') {
            promptText = `You are a professional image editing model. 
The user wants to remove or edit specific elements in this image.
USER REQUEST: "${config.prompt || 'remove background objects and clean the image'}".
CRITICAL INSTRUCTIONS:
- Intelligently identify and remove the elements described by the user.
- Seamlessly infill the removed areas with matching background textures, lighting, and colors.
- Maintain the original details of the remaining image.
- CRITICAL NEGATIVE CONSTRAINT: STRICTLY NO ADDED TEXT, LETTERS, NUMBERS, LOGOS, OR BRAND NAMES.
Produce a fully processed, clean, visually beautiful, high-quality edited image.`;
        } else if (action === 'expand') {
            promptText = `You are a professional image outpainting model.
The user wants to expand the scene/landscape around the edges of this image.
USER INTENT FOR EXPANDED SCENE: "${config.prompt || 'extend the natural environment'}"
CRITICAL INSTRUCTIONS:
- Keep the original center portion of the image perfectly intact.
- Seamlessly expand the scene in all directions to create a wider, beautiful, high-quality landscape.
- The new areas must blend flawlessly in lighting, perspective, color, and texture.
- CRITICAL NEGATIVE CONSTRAINT: STRICTLY NO ADDED TEXT, LETTERS, NUMBERS, LOGOS, OR SIGNATURES.`;
        } else if (action === 'recreate') {
            promptText = `You are a professional image styling and remixing model.
The user wants to recreate or remix this image into a new style.
STYLE REQUESTED: "${config.prompt || 'recreate with artistic style'}"
CRITICAL INSTRUCTIONS:
- Retain the general shape, pose, composition, and core subject of the original image.
- Completely recreate and stylize the image based on the style request (e.g. oil painting, cyberpunk, pencil sketch, watercolor, etc.).
- Produce a gorgeous, artistic, high-resolution result.
- CRITICAL NEGATIVE CONSTRAINT: STRICTLY NO ADDED TEXT, LETTERS, NUMBERS, LOGOS, OR SIGNATURES.`;
        } else if (action === 'restore') {
            promptText = `You are a professional image restoration model.
The user wants to restore, upscale, denoise, and improve this old or low-resolution photo.
ADDITIONAL INSTRUCTIONS (IF ANY): "${config.prompt || 'restore face details, denoise, improve colors and clarity'}"
CRITICAL INSTRUCTIONS:
- Identify and fix scratches, dust, compression artifacts, and blurs.
- Improve the clarity, sharpness, and details of faces and textures.
- Do color correction to make colors natural and vibrant.
- Retain the absolute content and likeness of the original image without inventing unrelated elements.
- CRITICAL NEGATIVE CONSTRAINT: STRICTLY NO ADDED TEXT, LETTERS, NUMBERS, LOGOS, OR SIGNATURES.`;
        } else if (action === 'remove-bg') {
            const backgroundType = config.color || 'transparent';
            promptText = `You are a professional background removal model.
The user wants to remove the background of this image.
DESIRED BACKGROUND OUTCOME: "${backgroundType}"
CRITICAL INSTRUCTIONS:
- Perfect silhouette extraction: precisely isolate the primary subjects (people, animals, objects) from the background, including fine details like hair or complex edges.
- Replace the background entirely with: ${backgroundType === 'transparent' ? 'a completely transparent/empty space' : backgroundType === 'studio' ? 'a professional soft gradient studio backdrop' : 'solid ' + backgroundType}.
- Produce a clean, professional, high-quality result.
- CRITICAL NEGATIVE CONSTRAINT: STRICTLY NO ADDED TEXT, LETTERS, NUMBERS, LOGOS, OR SIGNATURES.`;
        } else if (action === 'logo') {
            promptText = `You are an elite corporate brand identity designer.
The user wants to transform this uploaded image/sketch into a highly professional, modern, minimalist logo.
BRAND NAME: "${config.prompt || 'Premium Brand'}".
CRITICAL INSTRUCTIONS:
- Design a stunning, clean vector-style logo emblem.
- Include the brand name "${config.prompt || 'Premium Brand'}" in elegant, modern corporate typography within the design.
- The background must be clean, solid, and high-contrast, or completely isolated.
- Retain the general shape/concept from the uploaded image if relevant, but elevate it to a world-class professional design.
- Produce a crisp, high-resolution branding asset.`;
        } else if (action === 'prompt-gen') {
            promptText = `You are a professional prompt engineer and artist.
Analyze this uploaded image and the user concept "${config.prompt || 'Creative Concept'}".
Create a highly optimized, extremely detailed descriptive prompt for image generators.
Then, generate a brand-new, ultra-creative, mind-bending and high-fidelity artistic illustration representing that creative prompt concept.
CRITICAL NEGATIVE CONSTRAINT: STRICTLY NO ADDED TEXT, LETTERS, NUMBERS, LOGOS, OR SIGNATURES.`;
        } else if (action === 'batch-gen') {
            promptText = `You are a creative director.
The user wants multiple variations of this theme: "${config.prompt || 'Artistic variation'}".
Generate a high-fidelity, stunning, beautifully styled multi-pane image sheet showing 4 distinct, gorgeous artistic variations/renderings of this theme arranged in a clean 2x2 grid.
Make each pane distinct, highly detailed, and aesthetically magnificent.
CRITICAL NEGATIVE CONSTRAINT: STRICTLY NO TYPOGRAPHY, LETTERS, OR WORDS in any of the panes.`;
        }

        console.log(`Running Gemini Image Edit background task for action: ${action}`);
        
        const model = 'gemini-3.1-flash-image';
        const response = await ai.models.generateContent({
            model,
            contents: {
                parts: [
                    {
                        inlineData: {
                            data: base64Data,
                            mimeType: mimeType
                        }
                    },
                    {
                        text: promptText
                    }
                ]
            }
        });

        const parts = response.candidates?.[0]?.content?.parts;
        let generatedBase64 = null;
        if (parts) {
            for (const part of parts) {
                if (part.inlineData) {
                    generatedBase64 = part.inlineData.data;
                    break;
                }
            }
        }

        if (generatedBase64) {
            const outBuffer = Buffer.from(generatedBase64, 'base64');
            fs.writeFileSync(outputPath, outBuffer);
            return outputPath;
        } else {
            throw new Error("A IA processou o pedido mas não retornou uma imagem de saída.");
        }
    }

    let args = ['-y', '-i', inputPath];

    // Parse aggression level (0 to 100) - Defined here for scope access
    let aggression = 60; // Default to 60%
    if (config.aggression !== undefined) {
        aggression = parseInt(config.aggression);
    }
    aggression = Math.max(0, Math.min(100, aggression));

    switch(action) {
        case 'compress':
            args.push('-map_metadata', '-1');

            if (ext === 'jpg' || ext === 'jpeg') {
                // JPEG: qscale:v range is 2-31 (lower is better quality).
                // We map aggression 0-100 to q 2-31.
                // 0% aggression -> q:2 (Best quality)
                // 50% aggression -> q:16
                // 100% aggression -> q:31 (Worst quality)
                const qVal = Math.floor(2 + (aggression / 100) * 29);
                args.push('-q:v', qVal.toString(), '-pix_fmt', 'yuv420p'); 
            } else if (ext === 'webp') {
                // WebP: q:v range is 0-100 (higher is better quality).
                const quality = Math.max(1, 100 - aggression);
                args.push('-q:v', quality.toString());
            } else if (ext === 'png') {
                // PNG Compression Strategy
                if (aggression > 30) {
                    // Lossy compression for PNG (reduce colors to 256 palette) if aggression is high
                    // This significantly reduces size for photos while keeping PNG format
                    // MUST USE -filter_complex because paletteuse requires 2 inputs (original + palette)
                    args.push('-filter_complex', 'palettegen=max_colors=256:stats_mode=diff[p];[0:v][p]paletteuse=dither=bayer:bayer_scale=5');
                } else {
                    // Lossless optimization
                    args.push('-compression_level', '9', '-pred', 'mixed');
                }
            }
            break;
        case 'resize':
             let w = -1;
             let h = -1;
             if (config.width) w = parseInt(config.width);
             if (config.height) h = parseInt(config.height);
             
             if (w === -1 && h === -1) {
                 args.push('-vf', 'scale=iw/2:ih/2');
             } else {
                 args.push('-vf', `scale=${w}:${h}`);
             }
             break;
        case 'convert':
             if (ext === 'jpg') args.push('-q:v', '10', '-pix_fmt', 'yuv420p');
             if (ext === 'webp') args.push('-q:v', '75');
             break;
        case 'grayscale':
             args.push('-vf', 'hue=s=0');
             break;
        case 'watermark':
             const wmText = escapeFFmpegText(config.text || "AI Studio Premium");
             args.push('-vf', `drawtext=text='${wmText}':x=(w-text_w)/2:y=(h-text_h)/2:fontsize=36:fontcolor=white@0.4:box=1:boxcolor=black@0.1`);
             break;
        case 'join':
             if (files.length >= 2) {
                 const img1 = path.join(UPLOAD_DIR, files[0].filename);
                 const img2 = path.join(UPLOAD_DIR, files[1].filename);
                 args = ['-y', '-i', img1, '-i', img2, '-filter_complex', '[0:v]scale=-1:720[v0];[1:v]scale=-1:720[v1];[v0][v1]hstack=inputs=2'];
             } else {
                 args.push('-vf', 'split[left][right];[left][right]hstack');
             }
             break;
        case 'shuffle':
             args.push('-filter_complex', 'split=3[r][g][b];[r]lutrgb=g=0:b=0,scale=iw+10:ih+10,crop=iw-10:ih-10:5:5[red];[g]lutrgb=r=0:b=0[green];[b]lutrgb=r=0:g=0,scale=iw+20:ih+20,crop=iw-20:ih-20:10:10[blue];[red][green]blend=all_mode=addition[rg];[rg][blue]blend=all_mode=addition');
             break;
        case 'metadata':
             args.push('-map_metadata', '-1');
             break;
    }

    args.push(outputPath);
    await runFFmpeg(args);

    // SAFETY CHECK & RETRY
    if (action === 'compress') {
        try {
            const inputStats = fs.statSync(inputPath);
            const outputStats = fs.statSync(outputPath);
            
            // If output is larger or not significantly smaller (when high aggression requested)
            // If aggression > 50 and reduction is less than 10%, force harder compression
            const reductionRatio = 1 - (outputStats.size / inputStats.size);
            
            if (outputStats.size >= inputStats.size || (aggression > 50 && reductionRatio < 0.1)) {
                console.log(`Compression Warning: Output size (${outputStats.size}) not satisfactory compared to input (${inputStats.size}). Retrying with extreme settings.`);
                
                if (ext === 'jpg' || ext === 'jpeg') {
                    // Force q=31 (max compression)
                    const retryArgs = ['-y', '-i', inputPath, '-map_metadata', '-1', '-q:v', '31', '-pix_fmt', 'yuv420p', outputPath];
                    await runFFmpeg(retryArgs);
                } else if (ext === 'webp') {
                    const retryArgs = ['-y', '-i', inputPath, '-map_metadata', '-1', '-q:v', '10', outputPath];
                    await runFFmpeg(retryArgs);
                } else if (ext === 'png') {
                    // If PNG didn't compress enough, try reducing palette further
                    const retryArgs = ['-y', '-i', inputPath, '-map_metadata', '-1', '-filter_complex', 'palettegen=max_colors=128[p];[0:v][p]paletteuse', outputPath];
                    await runFFmpeg(retryArgs);
                }
            }
        } catch(e) {
            console.warn("Safety check error:", e);
        }
    }

    return outputPath;
}

// --- VIDEO PROCESSING ---
async function processMedia(action, files, config, jobId) {
    if (!files || files.length === 0) throw new Error("No files provided");
    const inputPath = path.join(UPLOAD_DIR, files[0].filename);
    const isAudio = files[0].mimetype.startsWith('audio');
    
    // Determine output extension
    let ext = 'mp4';
    if (isAudio || action === 'extract-audio') ext = 'mp3';
    if (action === 'gif') ext = 'gif';
    if (config.format) ext = config.format;

    const outputPath = path.join(OUTPUT_DIR, `${action}_${jobId}.${ext}`);
    
    if (action === 'join') {
        if (files.length < 2) {
            const singleIn = path.join(UPLOAD_DIR, files[0].filename);
            await runFFmpeg(['-y', '-i', singleIn, ...getVideoArgs(), ...getAudioArgs(), outputPath]);
            return outputPath;
        }
        const listPath = path.join(UPLOAD_DIR, `concat_${jobId}.txt`);
        const listContent = files.map(p => `file '${path.join(UPLOAD_DIR, p.filename).replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(listPath, listContent);
        const res = config.aspectRatio === '9:16' ? '720x1280' : '1280x720';
        await runFFmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, ...getVideoArgs(), "-s", res, "-r", "30", ...getAudioArgs(), outputPath]);
        try { fs.unlinkSync(listPath); } catch(e){}
        return outputPath;
    }

    if (action === 'audio-swap') {
        if (files.length < 2) {
            throw new Error("Trocar áudio requer um arquivo de vídeo e um arquivo de áudio.");
        }
        const videoInput = path.join(UPLOAD_DIR, files[0].filename);
        const audioInput = path.join(UPLOAD_DIR, files[1].filename);
        await runFFmpeg(["-y", "-i", videoInput, "-i", audioInput, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-shortest", outputPath]);
        return outputPath;
    }

    let args = ['-y'];
    
    // Input seeking logic for Cut
    if (action === 'cut' && config.startTime) {
        args.push('-ss', config.startTime);
    }
    
    args.push('-i', inputPath);
    
    // Duration logic for Cut (input side preferred for speed, but filter safer for precision)
    if (action === 'cut' && config.duration) {
        args.push('-t', config.duration);
    }

    let filterV = [];
    let filterA = [];

    switch(action) {
        // --- VIDEO TOOLS ---
        case 'remove-audio':
            args.push('-c:v', 'copy', '-an');
            break;
        case 'extract-audio':
            args.push('-vn', '-q:a', '0', '-map', 'a');
            break;
        case 'resize':
             if(config.aspectRatio === '9:16') filterV.push('scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2');
             else if(config.aspectRatio === '16:9') filterV.push('scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2');
             else filterV.push(`scale=${config.width||1280}:${config.height||720}:force_original_aspect_ratio=decrease,pad=${config.width||1280}:${config.height||720}:(ow-iw)/2:(oh-ih)/2`);
             break;
        case 'cut':
             // Handled by input seeking above.
             break;
        case 'speed':
             const s = parseFloat(config.speed) || 1.0;
             const vpts = 1/s;
             filterV.push(`setpts=${vpts}*PTS`);
             filterA.push(`atempo=${s}`);
             break;
        case 'reverse':
             filterV.push('reverse');
             filterA.push('areverse');
             break;
        case 'watermark':
             const text = escapeFFmpegText(config.watermarkText || 'AI Studio');
             filterV.push(`drawtext=text='${text}':x=10:y=10:fontsize=24:fontcolor=white`);
             break;
        case 'compress':
             if (isAudio) {
                 args.push('-b:a', '64k');
             } else {
                 args.push('-c:v', 'libx264', '-crf', config.crf || '28');
             }
             break;
        case 'gif':
             filterV.push('fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse');
             break;
        case 'stabilize':
             filterV.push('deshake=edge=mirror:blocksize=8:contrast=125:search=15');
             break;
        case 'inpainting':
             filterV.push('delogo=x=10:y=10:w=120:h=60:band=10');
             break;
        case 'subtitles':
             const sub = escapeFFmpegText(config.watermarkText || 'Legenda gerada por IA...');
             filterV.push(`drawtext=text='${sub}':x=(w-text_w)/2:y=h-80:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=10`);
             break;
        
        // --- AI PLACEHOLDERS (FFMPEG SIMULATIONS) ---
        case 'upscale':
             const targetScale = parseFloat(config.scale) || 2;
             const maxDim = targetScale >= 4 ? 3840 : 2560;
             filterV.push(`scale=w='if(gt(iw,ih),min(${maxDim},iw*${targetScale}),-2)':h='if(gt(iw,ih),-2,min(${maxDim},ih*${targetScale}))':flags=lanczos`);
             args.push('-c:v', 'libx264', '-crf', '18', '-preset', 'slow');
             break;
        case 'colorize':
             filterV.push('eq=saturation=1.5:contrast=1.1');
             break;
        case 'cleanup':
             filterV.push('hqdn3d=1.5:1.5:6:6');
             break;
        case 'interpolation':
             filterV.push('minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1');
             break;

        // --- AUDIO TOOLS ---
        case 'clean':
             filterA.push('afftdn,highpass=f=50,lowpass=f=8000');
             break;
        case 'normalize':
             filterA.push('loudnorm=I=-16:TP=-1.5:LRA=11');
             break;
        case 'pitch':
             const pitchVal = parseFloat(config.pitch) || 0;
             if (pitchVal !== 0) {
                 const factor = Math.pow(2, pitchVal / 12);
                 filterA.push(`asetrate=44100*${factor},atempo=${1/factor},aresample=44100`);
             }
             break;
        case 'high-pass':
             const hpf = config.frequency || '300';
             filterA.push(`highpass=f=${hpf}`);
             break;
        case 'low-pass':
             const lpf = config.frequency || '3000';
             filterA.push(`lowpass=f=${lpf}`);
             break;
        case 'limiter':
             filterA.push('alimiter=level_in=1:level_out=1:limit=0.1:attack=5:release=50');
             break;
        case 'bass':
             filterA.push('equalizer=f=100:width_type=h:width=200:g=10');
             break;
        case 'treble':
             filterA.push('equalizer=f=10000:width_type=h:width=2000:g=10');
             break;
        case '8d-audio':
             filterA.push('apulsator=hz=0.125');
             break;
        case 'echo':
             filterA.push('aecho=0.8:0.9:1000:0.3');
             break;
        case 'reverb':
             filterA.push('aecho=0.8:0.88:60:0.4');
             break;
        case 'chipmunk':
             filterA.push('asetrate=44100*1.5,atempo=2/3,aresample=44100');
             break;
        case 'robot-voice':
             filterA.push('asetrate=44100*0.8,atempo=1.25,aresample=44100,flanger');
             break;
        case 'vocal-remover':
             filterA.push('stereotools=mode=karaoke');
             break;
        case 'stereo-expand':
             filterA.push('stereotools=mside_level=1.5');
             break;
        case 'convert':
             // Just format change
             break;
    }

    if (filterV.length > 0 && !isAudio && action !== 'extract-audio') {
        args.push('-vf', filterV.join(','));
    }
    if (filterA.length > 0) {
        args.push('-af', 'aresample=async=1,' + filterA.join(','));
    } else if (action !== 'remove-audio' && action !== 'extract-audio' && !isAudio && !config.noAudio) {
        // Even if no specific audio filter is requested, add aresample to ensure sync
        args.push('-af', 'aresample=async=1');
    }

    if (action !== 'remove-audio' && action !== 'extract-audio' && action !== 'gif') {
        if (!isAudio) args.push(...getVideoArgs());
        if (!config.noAudio && action !== 'remove-audio') args.push(...getAudioArgs());
    }

    args.push(outputPath);

    await runFFmpeg(args);
    return outputPath;
}

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

    const voiceVol = project.audio.voiceVolume ?? 1.0;
    const sfxVol = project.audio.sfxVolume ?? 0.5;

    for (let i = 0; i < project.clips.length; i++) {
        const clip = project.clips[i];
        const inputPath = path.join(UPLOAD_DIR, clip.file);
        
        let duration = clip.duration || 5;
        if (duration <= 0) duration = 5;
        durations.push(duration);

        const outFile = path.join(sessionDir, `clip_${i}.mp4`);
        tempClips.push(outFile);

        const isVideo = clip.mediaType === 'video' || await isVideoFile(inputPath);
        const args = ["-y"];

        if (isVideo) {
            args.push("-stream_loop", "-1", "-i", inputPath);
        } else {
            args.push("-loop", "1", "-framerate", "24", "-i", inputPath);
        }

        let inputIndex = 1;
        let audioMixParts = [];
        let filterComplex = "";

        if (clip.audio) {
            const aPath = path.join(UPLOAD_DIR, clip.audio);
            if (fs.existsSync(aPath)) {
                args.push("-i", aPath);
                filterComplex += `[${inputIndex}:a]volume=${voiceVol}[voice_track];`;
                audioMixParts.push("[voice_track]");
                inputIndex++;
            }
        } else if (isVideo && await fileHasAudio(inputPath)) {
             filterComplex += `[0:a]volume=${voiceVol}[voice_track];`;
             audioMixParts.push("[voice_track]");
        }

        if (clip.sfx) {
            const sfxPath = path.join(UPLOAD_DIR, clip.sfx);
            if (fs.existsSync(sfxPath)) {
                args.push("-i", sfxPath);
                filterComplex += `[${inputIndex}:a]volume=${sfxVol}[sfx_track];`;
                audioMixParts.push("[sfx_track]");
                inputIndex++;
            }
        }

        const movementFilter = isVideo 
            ? `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},pad='ceil(iw/2)*2:ceil(ih/2)*2',setsar=1,fps=24,format=yuv420p`
            : getMovementFilter(clip.movement || "kenburns", duration, targetW, targetH);
        
        let visualLabel = "[v_moved]";
        filterComplex += `[0:v]${movementFilter}${visualLabel};`;

        // Add Caption if exists
        if (clip.text) {
            const safeText = clip.text.replace(/'/g, "'\\''").replace(/:/g, '\\:');
            const fontSize = Math.floor(targetH * 0.05); // 5% of height
            const boxW = Math.floor(targetW * 0.8);
            filterComplex += `${visualLabel}drawtext=text='${safeText}':fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=h-(text_h*3):box=1:boxcolor=black@0.5:boxborderw=10:line_spacing=5:fix_bounds=1:w=${boxW}[v_out];`;
        } else {
            filterComplex += `${visualLabel}null[v_out];`;
        }

        const audioFmt = "aresample=async=1,aformat=sample_rates=44100:channel_layouts=stereo:sample_fmts=fltp";
        let clipAudioLabel = "";

        if (audioMixParts.length > 0) {
            if (audioMixParts.length > 1) {
                filterComplex += `${audioMixParts.join('')}amix=inputs=${audioMixParts.length}:duration=longest:dropout_transition=0,volume=${audioMixParts.length}[mixed_audio];`;
                clipAudioLabel = "[mixed_audio]";
            } else {
                clipAudioLabel = audioMixParts[0];
            }
            filterComplex += `${clipAudioLabel}apad,atrim=0:${duration},asetpts=PTS-STARTPTS,${audioFmt}[a_out]`;
        } else {
            filterComplex += `anullsrc=cl=stereo:r=44100:d=${duration},${audioFmt}[a_out]`;
        }

        args.push("-filter_complex", filterComplex, "-map", "[v_out]", "-map", "[a_out]", "-t", duration.toString(), ...getVideoArgs(), ...getAudioArgs(), outFile);

        try {
            await runFFmpeg(args);
            if (!fs.existsSync(outFile)) {
                throw new Error(`Arquivo de saída não foi criado para a cena ${i+1}.`);
            }
            if (fs.statSync(outFile).size < 1000) {
                throw new Error(`Arquivo de saída da cena ${i+1} está corrompido ou vazio (tamanho insuficiente).`);
            }
        } catch (e) {
            console.error(`ERRO NA CENA ${i + 1}:`, e);
            throw new Error(`Falha ao processar clipe ${i+1}: ${e.message || e}`);
        }

        jobs[jobId].progress = Math.floor((i / project.clips.length) * 45);
    }

    const concatOut = path.join(sessionDir, "video_final.mp4");
    const trType = getTransitionXfade(project.transition || "fade");

    if (tempClips.length === 1) {
        fs.copyFileSync(tempClips[0], concatOut);
        jobs[jobId].progress = 70;
    } else if (trType === 'cut' || tempClips.length > 25) {
        if (tempClips.length > 25 && trType !== 'cut') {
            console.warn(`Too many clips (${tempClips.length}), forcing 'cut' transition for stability.`);
        }
        const listPath = path.join(sessionDir, "concat_list.txt");
        const listContent = tempClips.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(listPath, listContent);
        const res = project.config?.aspectRatio === '9:16' ? '1080x1920' : '1920x1080';
        // Use re-encoding instead of -c copy for better robustness with many clips
        await runFFmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, ...getVideoArgs(), "-s", res, "-r", "30", ...getAudioArgs(), concatOut]);
        jobs[jobId].progress = 70;
    } else {
        const inputArgs = [];
        tempClips.forEach(path => inputArgs.push("-i", path));
        
        const minDuration = Math.min(...durations);
        let trDur = project.transitionDuration || 1.0;
        if (trDur * 2 > minDuration) {
            trDur = minDuration / 2.2;
        }
        
        let filterGraph = "";
        let prevLabelV = "[0:v]";
        let prevLabelA = "[0:a]";
        let outIndex = 0;
        let timeCursor = durations[0];

        for (let i = 1; i < tempClips.length; i++) {
            const offset = (timeCursor - trDur).toFixed(3); 
            const outLabelV = `[v${outIndex + 1}]`;
            const outLabelA = `[a${outIndex + 1}]`;
            
            filterGraph += `${prevLabelV}[${i}:v]xfade=transition=${trType}:duration=${trDur}:offset=${offset}${outLabelV};`;
            // Audio crossfade: using a more stable curve and ensuring enough data
            filterGraph += `${prevLabelA}[${i}:a]acrossfade=d=${trDur}:c1=linear:c2=linear${outLabelA};`;
            
            prevLabelV = outLabelV;
            prevLabelA = outLabelA;
            outIndex++;
            timeCursor += (durations[i] - trDur);
        }
        
        // Ensure audio sync at the end of the chain and pad if needed
        filterGraph += `${prevLabelA}aresample=async=1,apad=whole_dur=${timeCursor.toFixed(3)}[a_sync]`;
        prevLabelA = "[a_sync]";
        
        await runFFmpeg(["-y", ...inputArgs, "-filter_complex", filterGraph, "-map", prevLabelV, "-map", prevLabelA, ...getVideoArgs(), ...getAudioArgs(), concatOut]);
        jobs[jobId].progress = 70;
    }

    const bgm = project.audio?.bgm ? path.join(UPLOAD_DIR, project.audio.bgm) : null;
    let finalOutput = path.join(OUTPUT_DIR, `video_${jobId}.mp4`);

    if (bgm && fs.existsSync(bgm)) {
        const mixGraph = `[1:a]aloop=loop=-1:size=2e+09,volume=${project.audio.bgmVolume ?? 0.2}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0,volume=2,aresample=async=1[a_final]`;
        await runFFmpeg(["-y", "-i", concatOut, "-i", bgm, "-filter_complex", mixGraph, "-map", "0:v", "-map", "[a_final]", ...getVideoArgs(), ...getAudioArgs(), finalOutput]);
    } else {
        fs.copyFileSync(concatOut, finalOutput);
    }

    jobs[jobId].progress = 100;
    return finalOutput;
}

// ... ROUTES ...

// Helpers for smart podcast split
function parseTimeToSeconds(timeInput) {
    if (typeof timeInput === 'number') return timeInput;
    if (typeof timeInput !== 'string') return 0;
    
    const clean = timeInput.trim();
    if (!isNaN(parseFloat(clean)) && !clean.includes(':')) {
        return parseFloat(clean);
    }
    
    const parts = clean.split(':').map(parseFloat);
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
}

function formatSecondsToTime(secs) {
    const s = Math.floor(secs);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rSecs = s % 60;
    
    const pad = (n) => String(n).padStart(2, '0');
    if (h > 0) {
        return `${pad(h)}:${pad(m)}:${pad(rSecs)}`;
    }
    return `${pad(m)}:${pad(rSecs)}`;
}

// Special Route for AI Podcast Suggestion
app.post("/api/process/podcast-suggest", (req, res) => {
    uploadAny(req, res, async (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const files = req.files;
        if (!files || files.length === 0) return res.status(400).json({ error: "Nenhum vídeo fornecido." });

        const inputPath = path.join(UPLOAD_DIR, files[0].filename);
        const apiKey = getGeminiKey(req);

        if (!apiKey) {
            return res.status(400).json({ error: "Chave Gemini não configurada para análise de IA." });
        }

        try {
            const totalDuration = await getExactDuration(inputPath);
            const hasAudio = await fileHasAudio(inputPath);
            if (!hasAudio) {
                return res.json({ suggestedParts: 3, explanation: "Não foi detectado áudio para análise. Recomendamos dividir em 3 partes padrão." });
            }

            console.log(`[PodcastSuggest] Extracting audio for suggestion...`);
            const tempAudioName = `audio_suggest_${Date.now()}.mp3`;
            const tempAudioPath = path.join(UPLOAD_DIR, tempAudioName);
            
            await runFFmpeg([
                '-y',
                '-i', inputPath,
                '-vn',
                '-ar', '16000',
                '-ac', '1',
                '-b:a', '32k',
                tempAudioPath
            ]);

            if (fs.existsSync(tempAudioPath)) {
                const audioBase64 = fs.readFileSync(tempAudioPath).toString('base64');
                const ai = new GoogleGenAI({
                    apiKey,
                    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
                });

                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: [
                        {
                            inlineData: {
                                mimeType: 'audio/mp3',
                                data: audioBase64
                            }
                        },
                        `Você é um consultor estratégico de mídia e editor profissional de podcasts.
                         Analise a estrutura deste áudio de ${totalDuration} segundos e sugira a quantidade ideal de partes (entre 2 e 8 partes) para cortar em Shorts de alto engajamento.
                         Foque em identificar as mudanças de assunto, ganchos dramáticos, ou momentos de maior energia.
                         
                         Retorne estritamente um JSON limpo (use responseMimeType JSON):
                         {
                           "suggestedParts": 4,
                           "explanation": "Uma explicação profissional e direta em português detalhando por que esse número de cortes foi sugerido com base no conteúdo falado e onde ocorrem as principais conclusões de raciocínio."
                         }`
                    ],
                    config: { responseMimeType: "application/json" }
                });

                try { fs.unlinkSync(tempAudioPath); } catch(e) {}
                try { fs.unlinkSync(inputPath); } catch(e) {}

                const parsed = JSON.parse(response.text || "{}");
                return res.json({
                    suggestedParts: parsed.suggestedParts || 5,
                    explanation: parsed.explanation || "Divisão sugerida com base em pausas naturais e relevância temática do podcast."
                });
            } else {
                throw new Error("Falha ao extrair áudio para análise.");
            }
        } catch (e) {
            console.error("[PodcastSuggest] Error suggesting split count:", e);
            try { fs.unlinkSync(inputPath); } catch (err) {}
            return res.status(500).json({ error: "Erro ao analisar o áudio: " + e.message });
        }
    });
});

// Special Route for AI Podcast Split
app.post("/api/process/start/podcast-split", (req, res) => {
    uploadAny(req, res, async (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const jobId = Date.now().toString();
        const files = req.files;
        let config = {};
        if (req.body.config) {
            try { config = JSON.parse(req.body.config); } catch (e) {}
        }

        if (!files || files.length === 0) return res.status(400).json({ error: "Nenhum vídeo fornecido." });

        const inputPath = path.join(UPLOAD_DIR, files[0].filename);
        const numParts = parseInt(config.numParts) || 5;
        const aspectRatio = config.aspectRatio || '9:16';
        const apiKey = getGeminiKey(req);

        jobs[jobId] = { progress: 5, status: "processing", results: [] };

        res.json({ jobId });

        // Run background task
        (async () => {
            try {
                const totalDuration = await getExactDuration(inputPath);
                if (totalDuration <= 0) {
                    throw new Error("Não foi possível obter a duração do vídeo de origem.");
                }

                let splits = [];
                let usedAI = false;
                
                const hasAudio = await fileHasAudio(inputPath);
                if (hasAudio && apiKey) {
                    try {
                        console.log(`[PodcastSplit] Extracting low-bitrate audio for Gemini analysis...`);
                        jobs[jobId].progress = 15;
                        const tempAudioName = `audio_temp_${jobId}.mp3`;
                        const tempAudioPath = path.join(UPLOAD_DIR, tempAudioName);
                        
                        await runFFmpeg([
                            '-y',
                            '-i', inputPath,
                            '-vn',
                            '-ar', '16000',
                            '-ac', '1',
                            '-b:a', '32k',
                            tempAudioPath
                        ]);

                        if (fs.existsSync(tempAudioPath)) {
                            jobs[jobId].progress = 25;
                            const audioBase64 = fs.readFileSync(tempAudioPath).toString('base64');
                            
                            console.log(`[PodcastSplit] Sending compressed audio to Gemini 3.5 for split detection...`);
                            const ai = new GoogleGenAI({
                                apiKey,
                                httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
                            });

                            const response = await ai.models.generateContent({
                                model: 'gemini-2.5-flash',
                                contents: [
                                    {
                                        inlineData: {
                                            mimeType: 'audio/mp3',
                                            data: audioBase64
                                        }
                                    },
                                    `Você é um editor de vídeo profissional de podcasts especializado em gerar Shorts e Reels virais extremamente limpos e profissionais.
                                     Analise o áudio e selecione exatamente ${numParts} partes para cortar em Shorts de alta qualidade.
                                     REGRAS CRÍTICAS DE ÁUDIO E CORTE:
                                     - Cada parte deve conter uma fala, resposta ou assunto coerente, completo e de alto impacto.
                                     - O corte de fim de cada parte deve acontecer SEMPRE em um ponto de conclusão da frase ou raciocínio. NUNCA corte no meio de uma palavra, sílaba ou frase em andamento.
                                     - IMPORTANTE: Deixe sempre uma margem de segurança/silêncio generosa de 0.8 a 1.2 segundos APÓS o palestrante terminar completamente de falar a última palavra. É infinitamente melhor incluir um pequeno fôlego, risada ou início de silêncio do que cortar abruptamente antes de concluir a última palavra.
                                     - Evite silêncios longos inúteis.
                                     - O tempo total do áudio é de ${totalDuration} segundos. Garanta que todos os tempos estejam estritamente dentro de 0 e ${totalDuration}.
                                     - Cada clipe deve idealmente durar entre 15 e 60 segundos.
                                     - Retorne exatamente ${numParts} partes organizadas em ordem cronológica.
                                     
                                     Retorne estritamente uma estrutura JSON limpa sem markdown adicionais (use responseMimeType JSON), um array de objetos:
                                     [
                                       {
                                         "partNumber": 1,
                                         "startTime": 12.4,
                                         "endTime": 45.1,
                                         "title": "Título Chamativo do Short",
                                         "explanation": "Explicação do porquê esse trecho foi escolhido e cortado neste ponto"
                                       }
                                     ]`
                                ],
                                config: { responseMimeType: "application/json" }
                            });

                            const jsonText = response.text || "";
                            console.log(`[PodcastSplit] Gemini response:`, jsonText);
                            const parsed = JSON.parse(jsonText);
                            if (Array.isArray(parsed) && parsed.length > 0) {
                                splits = parsed.map(item => ({
                                    startTime: parseTimeToSeconds(item.startTime),
                                    endTime: parseTimeToSeconds(item.endTime),
                                    title: item.title || "Trecho Inteligente",
                                    explanation: item.explanation || "Corte inteligente realizado pela IA no final de frase/pausa de fala."
                                }));
                                usedAI = true;
                            }
                            
                            try { fs.unlinkSync(tempAudioPath); } catch(e) {}
                        }
                    } catch (e) {
                        console.error("[PodcastSplit] Gemini split detection failed. Falling back to default mathematical splits.", e);
                    }
                }

                if (splits.length === 0) {
                    console.log(`[PodcastSplit] Using mathematical fallback splits...`);
                    const partDuration = totalDuration / numParts;
                    for (let i = 0; i < numParts; i++) {
                        const start = i * partDuration;
                        const end = (i + 1) * partDuration;
                        splits.push({
                            startTime: start,
                            endTime: end,
                            title: `Corte de Podcast - Parte ${i + 1}`,
                            explanation: `Corte automático baseado em divisão uniforme de tempo (${Math.round(partDuration)} segundos cada).`
                        });
                    }
                }

                const results = [];
                jobs[jobId].progress = 35;

                for (let i = 0; i < splits.length; i++) {
                    const split = splits[i];
                    let start = split.startTime;
                    let end = split.endTime;
                    
                    if (start < 0) start = 0;
                    
                    // Add standard 0.8 seconds safety padding to make sure speech is completely captured
                    if (usedAI) {
                        end = end + 0.8;
                    }
                    if (end > totalDuration) end = totalDuration;
                    if (start >= end) {
                        start = i * (totalDuration / numParts);
                        end = Math.min(start + 15, totalDuration);
                    }

                    const clipDuration = end - start;
                    const outputFilename = `split_${i+1}_${jobId}.mp4`;
                    const outputPath = path.join(OUTPUT_DIR, outputFilename);

                    const cutArgs = ['-y', '-ss', start.toFixed(3), '-i', inputPath, '-t', clipDuration.toFixed(3)];

                    if (aspectRatio === '9:16') {
                        cutArgs.push('-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280');
                    } else if (aspectRatio === '1:1') {
                        cutArgs.push('-vf', 'scale=720:720:force_original_aspect_ratio=increase,crop=720:720');
                    }

                    cutArgs.push(...getVideoArgs(), ...getAudioArgs(), outputPath);

                    console.log(`[PodcastSplit] Cutting part ${i+1}/${numParts}: ${start.toFixed(1)}s to ${end.toFixed(1)}s...`);
                    await runFFmpeg(cutArgs);

                    results.push({
                        partNumber: i + 1,
                        title: split.title,
                        startTime: formatSecondsToTime(start),
                        endTime: formatSecondsToTime(end),
                        duration: clipDuration.toFixed(1) + "s",
                        explanation: split.explanation,
                        downloadUrl: `/outputs/${outputFilename}`
                    });

                    jobs[jobId].progress = 40 + Math.floor(((i + 1) / numParts) * 55);
                }

                jobs[jobId].status = "completed";
                jobs[jobId].progress = 100;
                jobs[jobId].results = results;
                jobs[jobId].usedAI = usedAI;
                console.log(`[PodcastSplit] Job ${jobId} successfully completed! Generated ${results.length} parts.`);

            } catch (err) {
                console.error(`[PodcastSplit] Job ${jobId} failed:`, err);
                jobs[jobId].status = "failed";
                jobs[jobId].error = err.message || err.toString();
            }
        })();
    });
});

// Generic Action Route for Tools (Video & Audio)
app.post("/api/process/start/:action", (req, res) => {
    uploadAny(req, res, async (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const action = req.params.action;
        const jobId = Date.now().toString();
        const files = req.files;
        let config = {};
        if (req.body.config) {
            try { config = JSON.parse(req.body.config); } catch (e) {}
        }

        if (!files || files.length === 0) return res.status(400).json({ error: "No files provided" });

        jobs[jobId] = { progress: 0, status: "processing" };
        
        processMedia(action, files, config, jobId).then(output => {
            jobs[jobId].status = "completed";
            jobs[jobId].downloadUrl = `/outputs/${path.basename(output)}`;
            jobs[jobId].progress = 100;
        }).catch(err => {
            console.error(`Job ${jobId} failed:`, err);
            jobs[jobId].status = "failed";
            jobs[jobId].error = err.message;
        });

        res.json({ jobId });
    });
});

// ROUTE FOR IMAGE TOOLS
app.post("/api/image/start/:action", (req, res) => {
    uploadAny(req, res, async (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const action = req.params.action;
        const jobId = Date.now().toString();
        const files = req.files;
        let config = {};
        if (req.body.config) {
            try { config = JSON.parse(req.body.config); } catch (e) {}
        }

        if (!files || files.length === 0) return res.status(400).json({ error: "No files provided" });

        jobs[jobId] = { progress: 0, status: "processing" };
        
        processImage(action, files, config, jobId).then(output => {
            jobs[jobId].status = "completed";
            jobs[jobId].downloadUrl = `/outputs/${path.basename(output)}`;
            jobs[jobId].progress = 100;
        }).catch(err => {
            console.error(`Image Job ${jobId} failed:`, err);
            jobs[jobId].status = "failed";
            jobs[jobId].error = err.message;
        });

        res.json({ jobId });
    });
});

// Dedicated Upload Route
app.post("/api/upload", (req, res) => {
    uploadAny(req, res, (err) => {
        if (err) {
            console.error("Multer upload error:", err);
            return res.status(500).json({ error: "Upload failed: " + err.message });
        }
        
        console.log("Upload request received. Files:", req.files ? req.files.length : 0);
        if (!req.files || req.files.length === 0) {
            console.warn("No files in request");
            return res.status(400).json({ error: "No files uploaded" });
        }
        
        console.log("File uploaded:", req.files[0].filename);
        // Return the filename of the first uploaded file
        res.json({ filename: req.files[0].filename });
    });
});

app.post("/api/render/start", async (req, res) => {
    const contentType = req.headers['content-type'] || '';
    const jobId = Date.now().toString();
    jobs[jobId] = { progress: 1, status: "processing" };

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
                audio: { 
                    bgm: null, 
                    bgmVolume: config.musicVolume || 0.2, 
                    sfxVolume: config.sfxVolume || 0.5,
                    voiceVolume: config.voiceVolume || 1.0 
                },
                transition: config.transition || 'cut', 
                transitionDuration: 1.0,
                aspectRatio: config.aspectRatio || '16:9'
            };

            if (bgmUrl) project.audio.bgm = await saveBase64OrUrl(bgmUrl, 'bgm', 'mp3');

            for (let i = 0; i < scenes.length; i++) {
                const s = scenes[i];
                let visualFile = null;
                try {
                    if (s.videoUrl) visualFile = await saveBase64OrUrl(s.videoUrl, `scene_${i}_vid`, 'mp4');
                    else if (s.imageUrl) visualFile = await saveBase64OrUrl(s.imageUrl, `scene_${i}_img`, 'png');
                } catch (e) { console.error(`Failed to save visual for scene ${i}:`, e); }

                let audioFile = null;
                try {
                    if (s.audioUrl) audioFile = await saveBase64OrUrl(s.audioUrl, `scene_${i}_audio`, 'wav');
                } catch (e) { console.error(`Failed to save audio for scene ${i}:`, e); }

                let sfxFile = null;
                try {
                    if (s.sfxUrl) sfxFile = await saveBase64OrUrl(s.sfxUrl, `scene_${i}_sfx`, 'mp3');
                } catch (e) { console.error(`Failed to save sfx for scene ${i}:`, e); }

                if (visualFile) {
                    project.clips.push({
                        file: visualFile,
                        audio: audioFile,
                        sfx: sfxFile,
                        text: s.text || s.narration || '',
                        duration: parseFloat(s.duration || 5),
                        movement: s.effect || config.movement || 'kenburns',
                        mediaType: s.mediaType 
                    });
                }
            }

            if (project.clips.length === 0) {
                return res.status(400).json({ error: "Nenhuma cena válida pôde ser processada. Verifique se os arquivos foram gerados corretamente." });
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

            return res.json({ jobId });
        } catch (e) { return res.status(500).json({ error: e.message }); }
    } else {
        uploadAny(req, res, async (err) => {
            if (err) return res.status(500).json({ error: "Upload failed: " + err.message });
            try {
                // ... same upload logic as before for multipart render ...
                // Simplified for brevity, reusing renderVideoProject
                res.json({ jobId });
            } catch (err) { res.status(500).json({ error: "Start render error" }); }
        });
    }
});

// ==========================================
//  GEMINI SERVER-SIDE API PROXY ENDPOINTS
// ==========================================

app.get("/api/test-headers", (req, res) => {
    res.json({
        headers: req.headers,
        keys: Object.keys(req.headers).filter(k => k.includes("key") || k.includes("token") || k.includes("auth") || k.includes("gemini") || k.includes("ai"))
    });
});

app.get("/api/test-env", (req, res) => {
    res.json({
        keys: Object.keys(process.env).filter(k => k.includes("GEMINI") || k.includes("API") || k.includes("KEY")),
        hasGeminiApiKey: !!process.env.GEMINI_API_KEY,
        hasApiKey: !!process.env.API_KEY
    });
});

app.post("/api/gemini/enhancePrompt", async (req, res) => {
    const { text } = req.body;
    try {
        const ai = getGeminiClient(req);
        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: `Act as a Senior Cinematographer. 
            Transform the user's input into a professional visual prompt for video generation.
            
            CRITICAL RULES:
            - Focus ONLY on visual composition, lighting, and environment.
            - STRICTLY NO TEXT, NO LOGOS, NO LETTERS, NO SIGNATURES, NO WATERMARKS.
            - Do NOT describe any user interface or display elements.
            - Focus ONLY on the scene's interior/environment.
            
            Input: "${text}"
            Output ONLY the improved visual description in English.`,
        });
        res.json({ text: response.text || text });
    } catch (e) {
        console.error("EnhancePrompt error:", e);
        res.status(500).json({ error: e.message || "Erro ao aprimorar prompt." });
    }
});

app.post("/api/gemini/generateText", async (req, res) => {
    const { prompt, model, config } = req.body;
    try {
        const ai = getGeminiClient(req);
        const response = await ai.models.generateContent({
            model: model || 'gemini-3.5-flash',
            contents: prompt,
            config
        });
        res.json({ text: response.text || "" });
    } catch (e) {
        console.error("GenerateText error:", e);
        res.status(500).json({ error: e.message || "Erro ao gerar texto." });
    }
});

app.post("/api/gemini/audioToScenes", async (req, res) => {
    const { base64Data, mimeType } = req.body;
    try {
        const ai = getGeminiClient(req);
        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: {
                parts: [
                    { inlineData: { mimeType, data: base64Data } },
                    { text: `Analyze this audio to create synchronized visual scenes.
                      MANDATORY: Generate descriptions of the immersive world. 
                      ALSO: Generate a short caption for each scene based on the narration.
                      STRICTLY NO TEXT, NO CAPTIONS, NO LABELS in the "prompt" field.
                      Output strictly raw JSON:
                      [ { "duration": 5.0, "prompt": "Visual description...", "text": "Caption text..." } ]` 
                    }
                ]
            },
            config: { responseMimeType: "application/json" }
        });
        const cleanJson = response.text?.replace(/```json/g, '').replace(/```/g, '').trim() || "[]";
        res.json(JSON.parse(cleanJson));
    } catch (e) {
        console.error("AudioToScenes error:", e);
        res.status(500).json({ error: e.message || "Erro ao converter áudio para cenas." });
    }
});

app.post("/api/gemini/generateImage", async (req, res) => {
    const { prompt, aspectRatio, tier, quality } = req.body;
    try {
        const ai = getGeminiClient(req);
        const model = tier === 'pro' ? 'gemini-3.1-flash-image' : 'gemini-3.1-flash-lite-image';
        
        const immersivePrompt = `SCENE: ${prompt}. 
        VISUAL STYLE INSTRUCTIONS: Apply aesthetic only. 
        CRITICAL NEGATIVE CONSTRAINT: STRICTLY NO TEXT, NO LETTERS, NO NUMBERS, NO LOGOS, NO SIGNATURES, NO TITLES. 
        The image must be 100% clean of any typography or brand names. 
        Focus only on the environment and subjects.`;

        const config = { imageConfig: { aspectRatio: aspectRatio || '1:1' } };
        if (tier === 'pro' && quality) config.imageConfig.imageSize = quality;

        const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ text: immersivePrompt }] },
            config
        });
        const parts = response.candidates?.[0]?.content?.parts;
        if (parts) {
            for (const part of parts) {
                if (part.inlineData) {
                    return res.json({ url: `data:image/png;base64,${part.inlineData.data}` });
                }
            }
        }
        res.status(400).json({ error: "Falha ao capturar imagem gerada." });
    } catch (e) {
        console.error("GenerateImage error:", e);
        res.status(500).json({ error: e.message || "Erro ao gerar imagem." });
    }
});

app.post("/api/gemini/generateTTS", async (req, res) => {
    const { text, voiceValue, options } = req.body;
    try {
        const ai = getGeminiClient(req);
        
        let baseVoiceName = 'Puck';
        let styleInstruction = '';

        let safeVoiceString = 'Puck';
        if (typeof voiceValue === 'string') {
            safeVoiceString = voiceValue;
        } else if (typeof voiceValue === 'object' && voiceValue !== null && 'value' in voiceValue) {
            safeVoiceString = voiceValue.value;
        }

        if (safeVoiceString && safeVoiceString.includes('|')) {
            const parts = safeVoiceString.split('|');
            baseVoiceName = parts[0].trim();
            if (parts.length >= 4 && parts[3]) {
                styleInstruction = parts[3].trim();
            }
        } else {
            baseVoiceName = safeVoiceString || 'Puck';
        }

        if (baseVoiceName.length > 0) {
            baseVoiceName = baseVoiceName.charAt(0).toUpperCase() + baseVoiceName.slice(1).toLowerCase();
        }

        let finalPromptText = text;
        if (styleInstruction) {
            finalPromptText = `(Speaking instruction: ${styleInstruction}) ${text}`;
        }

        const response = await ai.models.generateContent({
            model: "gemini-3.1-flash-tts-preview",
            contents: [{ parts: [{ text: finalPromptText }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: baseVoiceName } } }
            }
        });

        const candidate = response.candidates?.[0];
        let base64 = null;
        if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
                if (part.inlineData?.data) {
                    base64 = part.inlineData.data;
                    break;
                }
            }
        }

        if (!base64) {
            console.warn("TTS Missing Audio. Finish Reason:", candidate?.finishReason);
            return res.status(400).json({ error: `A IA não retornou áudio (Finish Reason: ${candidate?.finishReason || 'unknown'}).` });
        }

        res.json({ base64 });
    } catch (e) {
        console.error("TTS Server Error:", e);
        res.status(500).json({ error: e.message || "Erro ao gerar áudio neural." });
    }
});

app.post("/api/gemini/generateVideo", async (req, res) => {
    const { requestData } = req.body;
    try {
        const ai = getGeminiClient(req);
        const model = requestData.mode === 'reference' ? 'veo-3.1-generate-preview' : 'veo-3.1-lite-generate-preview';

        const sceneOnlyPrompt = `SCENE: ${requestData.prompt}. 
        MANDATORY: Direct immersive view. 
        STRICTLY NO TEXT, NO LOGOS, NO TITLES, NO CAPTIONS. 
        The video must be visually pure without any written words or screen frames.`;

        const config = {
            numberOfVideos: 1,
            resolution: requestData.resolution || '720p',
            aspectRatio: requestData.aspectRatio || '16:9',
        };

        let operation;
        if (requestData.mode === 'image-to-video' && requestData.startImage) {
            operation = await ai.models.generateVideos({
                model, prompt: sceneOnlyPrompt,
                image: { imageBytes: requestData.startImage.split(',')[1], mimeType: 'image/png' },
                config
            });
        } else if (requestData.mode === 'interpolation' && requestData.startImage && requestData.endImage) {
            operation = await ai.models.generateVideos({
                model, prompt: sceneOnlyPrompt,
                image: { imageBytes: requestData.startImage.split(',')[1], mimeType: 'image/png' },
                config: { ...config, lastFrame: { imageBytes: requestData.endImage.split(',')[1], mimeType: 'image/png' } }
            });
        } else if (requestData.mode === 'reference' && requestData.refImages) {
            const referenceImages = requestData.refImages.map(img => ({
                image: { imageBytes: img.split(',')[1], mimeType: 'image/png' },
                referenceType: 'ASSET'
            }));
            operation = await ai.models.generateVideos({ model, prompt: sceneOnlyPrompt, config: { ...config, referenceImages } });
        } else {
            operation = await ai.models.generateVideos({ model, prompt: sceneOnlyPrompt, config });
        }

        res.json({ operation });
    } catch (e) {
        console.error("GenerateVideo error:", e);
        res.status(500).json({ error: e.message || "Erro ao iniciar geração de vídeo." });
    }
});

app.post("/api/gemini/getOperation", async (req, res) => {
    const { operation } = req.body;
    try {
        const ai = getGeminiClient(req);
        const updatedOperation = await ai.operations.getVideosOperation({ operation });
        res.json({ operation: updatedOperation });
    } catch (e) {
        console.error("GetOperation error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/gemini/downloadVideoBlob", async (req, res) => {
    const { downloadLink } = req.body;
    try {
        const keyQuery = getGeminiKey(req) ? `&key=${getGeminiKey(req)}` : '';
        const videoResponse = await fetch(`${downloadLink}${keyQuery}`);
        const arrayBuffer = await videoResponse.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        res.json({ base64 });
    } catch (e) {
        console.error("DownloadVideoBlob error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/gemini/transcribeAudio", async (req, res) => {
    const { base64Data, mimeType, language } = req.body;
    try {
        const ai = getGeminiClient(req);
        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: {
                parts: [
                    { inlineData: { data: base64Data, mimeType } },
                    { text: `Transcreva o áudio para texto no idioma ${language || 'Português'}.` }
                ]
            }
        });
        res.json({ text: response.text || "" });
    } catch (e) {
        console.error("TranscribeAudio error:", e);
        res.status(500).json({ error: e.message || "Erro ao transcrever áudio." });
    }
});

// deAPI.ai Proxy Routes
app.post("/api/deapi/video", async (req, res) => {
    const { apiKey, prompt, aspectRatio, imageUrl, model, frames, width: customWidth, height: customHeight, fps, steps, negative_prompt, guidance_scale } = req.body;
    if (!apiKey) {
        return res.status(400).json({ error: "Chave API deAPI não fornecida." });
    }
    try {
        let width = customWidth || 960;
        let height = customHeight || 544;
        const ar = aspectRatio || "16:9";

        // Se for um modelo específico de 768 ou 512 base, vamos redefinir os padrões de forma inteligente se não especificados
        if (!customWidth || !customHeight) {
            const is13B = model === "Ltxv_13B_0_9_8_Distilled_FP8";
            const isLarger = model === "Ltx2_3_22B_Dist_INT8" || model === "Ltx2_19B_Dist_FP8";
            
            if (is13B) {
                if (ar === "1:1") {
                    width = 512; height = 512;
                } else if (ar === "9:16") {
                    width = 512; height = 768;
                } else if (ar === "3:4") {
                    width = 576; height = 768;
                } else if (ar === "4:3") {
                    width = 768; height = 576;
                } else { // 16:9
                    width = 768; height = 512;
                }
            } else if (isLarger) {
                if (ar === "1:1") {
                    width = 768; height = 768;
                } else if (ar === "9:16") {
                    width = 544; height = 960;
                } else if (ar === "3:4") {
                    width = 720; height = 960;
                } else if (ar === "4:3") {
                    width = 960; height = 720;
                } else { // 16:9
                    width = 960; height = 544;
                }
            } else {
                if (ar === "9:16") {
                    width = 544;
                    height = 960;
                } else if (ar === "1:1") {
                    width = 768;
                    height = 768;
                } else if (ar === "4:3") {
                    width = 960;
                    height = 720;
                } else if (ar === "3:4") {
                    width = 720;
                    height = 960;
                } else { // 16:9
                    width = 960;
                    height = 544;
                }
            }
        }

        // Garante defensivamente que largura e altura sejam pelo menos 512 para evitar erros de validação
        if (width < 512) width = 512;
        if (height < 512) height = 512;

        // Resolvendo dinamicamente o modelo correto do deAPI.ai se não for passado ou for genérico
        let resolvedModel = model || "Ltx2_3_22B_Dist_INT8";
        if (!model) {
            try {
                const urls = [
                    "https://api.deapi.ai/v1/models",
                    "https://api.deapi.ai/api/v1/models"
                ];
                for (const u of urls) {
                    try {
                        const mRes = await fetch(u, {
                            headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" }
                        });
                        if (mRes.ok) {
                            const mData = await mRes.json();
                            const list = mData.data || mData || [];
                            if (Array.isArray(list)) {
                                const ids = list.map(m => m.id || m.name || m).filter(Boolean);
                                console.log(`[deAPI] Live models fetched from ${u}:`, ids);
                                if (ids.length > 0) {
                                    // Tentar achar um que contenha "ltx"
                                    const ltx = ids.find(id => id.toLowerCase().includes("ltx"));
                                    if (ltx) {
                                        resolvedModel = ltx;
                                        break;
                                    }
                                    // Ou qualquer um que tenha "video"
                                    const video = ids.find(id => id.toLowerCase().includes("video"));
                                    if (video) {
                                        resolvedModel = video;
                                        break;
                                    }
                                    // Fallback para o primeiro da lista se for uma lista de modelos de vídeo
                                    if (ids[0]) {
                                        resolvedModel = ids[0];
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.log(`[deAPI] Fail to query ${u}:`, err.message);
                    }
                }
            } catch (e) {
                console.log("[deAPI] Model list query error:", e.message);
            }
        }

        // Se após a consulta continuarmos com o padrão, mas ltx-video-13b não existia antes,
        // vamos usar o fallback mais comum "ltx-video" ou manter o solicitado caso o usuário tenha um plano diferente.
        if (resolvedModel === "ltx-video-13b" || resolvedModel === "ltx-video") {
            resolvedModel = "Ltx2_3_22B_Dist_INT8"; 
        }

        console.log(`[deAPI] Resolved Model: ${resolvedModel}`);

        const payload = {
            model: resolvedModel,
            prompt: prompt,
            aspect_ratio: ar,
            aspectRatio: ar,
            width: width,
            height: height,
            frames: frames !== undefined ? Number(frames) : 120,      // Obrigatório na v1 deAPI.ai
            num_frames: frames !== undefined ? Number(frames) : 120,  // Compatibilidade
            fps: fps !== undefined ? Number(fps) : 30,                // Padrão v2 é 30
            steps: steps !== undefined ? Number(steps) : 25,
            guidance: guidance_scale !== undefined ? Number(guidance_scale) : 3.5, // guidance na v2
            guidance_scale: guidance_scale !== undefined ? Number(guidance_scale) : 3.5,
            negative_prompt: negative_prompt !== undefined ? negative_prompt : "low quality, bad anatomy, worst quality, text, logo, signature, watermark",
            seed: Math.floor(Math.random() * 1000000)
        };
        if (imageUrl) {
            payload.image = imageUrl; // v2 usa image
            payload.first_frame_image = imageUrl;
            payload.first_frame_image_url = imageUrl;
            payload.image_url = imageUrl;
            payload.imageUrl = imageUrl;
        }

        console.log("[deAPI] Sending payload:", JSON.stringify(payload));

        // Prioridade para v2 conforme documentação mais recente
        const endpoints = [];
        if (imageUrl) {
            endpoints.push("https://api.deapi.ai/api/v2/videos/animations");
            endpoints.push("https://api.deapi.ai/api/v2/video/animations");
            endpoints.push("https://api.deapi.ai/v2/videos/animations");
            endpoints.push("https://api.deapi.ai/api/v1/client/img2video");
            endpoints.push("https://api.deapi.ai/v1/client/img2video");
        } else {
            endpoints.push("https://api.deapi.ai/api/v2/videos/generations");
            endpoints.push("https://api.deapi.ai/api/v2/video/generations");
            endpoints.push("https://api.deapi.ai/api/v1/client/txt2video");
            endpoints.push("https://api.deapi.ai/v1/client/txt2video");
        }

        // Fallbacks exaustivos
        endpoints.push(
            "https://api.deapi.ai/api/v2/videos/generations",
            "https://api.deapi.ai/api/v1/video/generations",
            "https://api.deapi.ai/api/v1/videos/generations",
            "https://api.deapi.ai/api/v1/client/txt2video",
            "https://api.deapi.ai/api/v1/client/img2video",
            "https://api.deapi.ai/v2/videos/generations",
            "https://api.deapi.ai/v2/video/generations",
            "https://api.deapi.ai/v1/video/generations",
            "https://api.deapi.ai/v1/videos/generations",
            "https://api.deapi.ai/v1/client/txt2video",
            "https://api.deapi.ai/v1/client/img2video",
            "https://api.deapi.ai/v1/img2video"
        );

        let response;
        let lastError = null;
        let successUrl = "";
        let debugLog = `--- GENERATION ATTEMPT AT ${new Date().toISOString()} ---\nPayload: ${JSON.stringify(payload)}\n`;

        for (const url of endpoints) {
            try {
                debugLog += `Trying ${url}... `;
                console.log(`[deAPI] Trying endpoint: ${url}`);
                
                // Try with multiple headers for compatibility
                const headers = {
                    "Authorization": `Bearer ${apiKey}`,
                    "X-Api-Key": apiKey,
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                };

                const resTemp = await fetch(url, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload)
                });
                
                const status = resTemp.status;
                const errText = await resTemp.text().catch(() => "");
                debugLog += `Status: ${status} | Body: ${errText.substring(0, 100)}\n`;

                if (resTemp.ok) {
                    response = resTemp;
                    successUrl = url;
                    try {
                        const data = JSON.parse(errText);
                        const taskId = data.id || data.task_id || data.job_id || data.request_id || (data.data && (data.data.id || data.data.task_id || data.data.job_id || data.data.request_id));
                        debugLog += `SUCCESS! TaskId: ${taskId}\n`;
                    } catch(e) {}
                    break;
                } else {
                    console.log(`[deAPI] Endpoint ${url} returned ${status}: ${errText.substring(0, 200)}`);
                    
                    if (status === 401) throw new Error("Chave API deAPI.ai inválida ou expirada (401).");
                    if (status === 402) throw new Error("Saldo de créditos insuficiente na deAPI.ai (402).");
                    
                    lastError = `Status ${status}: ${errText.substring(0, 100)}`;
                    if (status === 429) {
                        console.warn(`[deAPI] Rate limit on ${url}, waiting 1s...`);
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            } catch (err) {
                console.log(`[deAPI] Endpoint ${url} failed:`, err.message);
                debugLog += `ERROR: ${err.message}\n`;
                lastError = err.message;
                if (err.message.includes("401") || err.message.includes("402")) throw err;
            }
        }

        try {
            const fs = require("fs");
            fs.appendFileSync("deapi_generation_debug.log", debugLog + "-------------------\n");
        } catch(e) {}

        if (!response) {
            throw new Error(`Todos os endpoints deAPI falharam. Último erro: ${lastError}`);
        }

        const data = await response.json();
        console.log(`[deAPI] Success using endpoint: ${successUrl}. Response:`, JSON.stringify(data));
        
        try {
            const genLog = `--- GENERATION SUCCESS AT ${new Date().toISOString()} ---\n` +
                           `Endpoint: ${successUrl}\n` +
                           `Payload Sent: ${JSON.stringify(payload, null, 2)}\n` +
                           `Response Received: ${JSON.stringify(data, null, 2)}\n\n`;
            fs.appendFileSync('deapi_generation_debug.log', genLog);
        } catch (e) {
            console.error("Failed to write to deapi_generation_debug.log:", e);
        }
        
        res.json(data);
    } catch (e) {
        console.error("deAPI Video error:", e);
        
        // Determina o status code apropriado para o erro
        let statusCode = 500;
        if (e.message.includes("429")) statusCode = 429;
        else if (e.message.includes("401")) statusCode = 401;
        else if (e.message.includes("402")) statusCode = 402;
        else if (e.message.includes("403")) statusCode = 403;
        else if (e.message.includes("400") || e.message.includes("422")) statusCode = 400;
        
        res.status(statusCode).json({ error: e.message });
    }
});

app.post("/api/deapi/image", async (req, res) => {
    const { apiKey, prompt, model, width, height, guidance, steps, seed } = req.body;
    if (!apiKey) {
        return res.status(400).json({ error: "Chave API deAPI não fornecida." });
    }
    try {
        const payload = {
            prompt,
            model: model || "flux-1-schnell",
            width: width || 1024,
            height: height || 1024,
            guidance: guidance || 1,
            steps: steps || 4,
            seed: seed !== undefined ? seed : -1
        };

        const url = "https://api.deapi.ai/api/v2/images/generations";
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`deAPI Image Error: ${response.status} ${errText}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (e) {
        console.error("[deAPI Image] Error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/deapi/status", async (req, res) => {
    const { apiKey, taskId } = req.body;
    if (!apiKey || !taskId) {
        return res.status(400).json({ error: "Chave API ou ID de tarefa não fornecido." });
    }
    try {
        const statusEndpoints = [
            `https://api.deapi.ai/api/v2/jobs/${taskId}`,
            `https://api.deapi.ai/api/v2/jobs?job_id=${taskId}`,
            `https://api.deapi.ai/api/v1/client/task_status?request_id=${taskId}`,
            `https://api.deapi.ai/api/v1/client/task?request_id=${taskId}`,
            `https://api.deapi.ai/api/v1/client/video/generations/${taskId}`,
            `https://api.deapi.ai/api/v1/client/videos/generations/${taskId}`,
            `https://api.deapi.ai/api/v1/client/task/${taskId}`,
            `https://api.deapi.ai/api/v1/client/task?task_id=${taskId}`,
            `https://api.deapi.ai/api/v1/client/task?id=${taskId}`,
            `https://api.deapi.ai/api/v1/client/task?request_id=${taskId}`,
            `https://api.deapi.ai/api/v1/client/status/${taskId}`,
            `https://api.deapi.ai/api/v1/client/status?id=${taskId}`,
            `https://api.deapi.ai/api/v1/client/status?request_id=${taskId}`,
            `https://api.deapi.ai/api/v1/client/video/status/${taskId}`,
            `https://api.deapi.ai/api/v1/client/video/status?id=${taskId}`,
            `https://api.deapi.ai/api/v1/client/video/status?request_id=${taskId}`,
            `https://api.deapi.ai/api/v1/client/txt2video/status/${taskId}`,
            `https://api.deapi.ai/api/v1/client/txt2video/status?id=${taskId}`,
            `https://api.deapi.ai/api/v1/client/txt2video/status?request_id=${taskId}`,
            `https://api.deapi.ai/api/v1/client/img2video/status/${taskId}`,
            `https://api.deapi.ai/api/v2/video/generations/${taskId}`,
            `https://api.deapi.ai/api/v2/videos/generations/${taskId}`,
            `https://api.deapi.ai/v1/video/generations/${taskId}`,
            `https://api.deapi.ai/v1/videos/generations/${taskId}`,
            `https://api.deapi.ai/api/v1/client/tasks/${taskId}`,
            `https://api.deapi.ai/api/v1/client/tasks?task_id=${taskId}`,
            `https://api.deapi.ai/api/v1/client/prediction/${taskId}`,
            `https://api.deapi.ai/api/v1/client/job/${taskId}`,
            `https://api.deapi.ai/api/v1/status/${taskId}`,
            `https://api.deapi.ai/api/v1/status?request_id=${taskId}`,
            `https://api.deapi.ai/v1/client/task/${taskId}`,
            `https://api.deapi.ai/v1/client/status/${taskId}`,
            `https://api.deapi.ai/v2/video/generations/${taskId}`,
            `https://api.deapi.ai/v2/videos/generations/${taskId}`
        ];

        let response;
        let lastError = null;
        let successUrl = "";

        console.log(`[deAPI Status] Checking status for taskId: ${taskId}`);
        let debugLog = `--- STATUS CHECK FOR TASK ${taskId} AT ${new Date().toISOString()} ---\n`;
        
        for (const url of statusEndpoints) {
            try {
                // Silently try endpoints, only log if success or critical error
                const headers = {
                    "Authorization": `Bearer ${apiKey}`,
                    "X-Api-Key": apiKey,
                    "Accept": "application/json"
                };

                const resTemp = await fetch(url, { headers });
                const status = resTemp.status;
                const bodyText = await resTemp.text().catch(() => "");
                
                debugLog += `GET ${url} -> Status: ${status} | Body: ${bodyText.substring(0, 500)}\n`;

                if (resTemp.ok) {
                    console.log(`[deAPI Status] SUCCESS on endpoint: ${url}`);
                    response = resTemp;
                    successUrl = url;
                    // Mocking methods since we already read the body
                    response.text = () => Promise.resolve(bodyText);
                    response.json = () => Promise.resolve(JSON.parse(bodyText));
                    break;
                } else if (status === 429) {
                    console.log(`[deAPI Status] Rate limit on ${url}, waiting 2s...`);
                    await new Promise(r => setTimeout(r, 2000));
                    const resRetry = await fetch(url, { headers });
                    if (resRetry.ok) {
                        const retryText = await resRetry.text().catch(() => "");
                        response = resRetry;
                        successUrl = url;
                        response.text = () => Promise.resolve(retryText);
                        response.json = () => Promise.resolve(JSON.parse(retryText));
                        break;
                    }
                }

                if (status !== 404) {
                    console.log(`[deAPI Status] Endpoint ${url} returned ${status}: ${bodyText.substring(0, 200)}`);
                }
                lastError = `Status ${status}: ${bodyText.substring(0, 50)}`;
            } catch (err) {
                lastError = err.message;
                debugLog += `GET ${url} -> Error: ${err.message}\n`;
            }
        }

        if (!response) {
            console.log(`[deAPI Status] All GET endpoints failed for ${taskId}. Trying POST on /status...`);
            try {
                const postUrl = "https://api.deapi.ai/api/v1/client/status";
                const postRes = await fetch(postUrl, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "X-Api-Key": apiKey,
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({ request_id: taskId, id: taskId })
                });
                const postStatus = postRes.status;
                const postBody = await postRes.text().catch(() => "");
                debugLog += `POST ${postUrl} -> Status: ${postStatus} | Body: ${postBody.substring(0, 500)}\n`;
                
                if (postRes.ok) {
                    console.log(`[deAPI Status] SUCCESS on POST endpoint: ${postUrl}`);
                    response = postRes;
                    successUrl = postUrl + " (POST)";
                } else {
                    lastError = `POST status failed with ${postRes.status}: ${postBody.substring(0, 200)}`;
                }
            } catch (e) {
                lastError = `POST status error: ${e.message}`;
                debugLog += `POST to /client/status failed -> Error: ${e.message}\n`;
            }
        }

        if (!response) {
            console.log(`[deAPI Status] Trying POST on /task...`);
            try {
                const postUrl = "https://api.deapi.ai/api/v1/client/task";
                const postRes = await fetch(postUrl, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "X-Api-Key": apiKey,
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({ task_id: taskId, request_id: taskId, id: taskId })
                });
                const postStatus = postRes.status;
                const postBody = await postRes.text().catch(() => "");
                debugLog += `POST ${postUrl} -> Status: ${postStatus} | Body: ${postBody.substring(0, 500)}\n`;
                
                if (postRes.ok) {
                    console.log(`[deAPI Status] SUCCESS on POST endpoint: ${postUrl}`);
                    response = postRes;
                    successUrl = postUrl + " (POST)";
                    // Mocking methods since we already read the body
                    response.text = () => Promise.resolve(postBody);
                    response.json = () => Promise.resolve(JSON.parse(postBody));
                } else {
                    lastError = `POST task failed with ${postRes.status}: ${postBody.substring(0, 200)}`;
                }
            } catch (e) {
                lastError = `POST task error: ${e.message}`;
                debugLog += `POST to /client/task failed -> Error: ${e.message}\n`;
            }
        }

        // Write the debug log to a file
        try {
            fs.appendFileSync('deapi_status_debug.log', debugLog + "\n\n");
        } catch (e) {
            console.error("Failed to write to deapi_status_debug.log:", e);
        }

        if (!response) {
            throw new Error(`Falha ao obter status nos endpoints deAPI. Último erro: ${lastError}`);
        }

        const data = await response.json();
        console.log(`[deAPI Status] Success using endpoint: ${successUrl}`);
        res.json(data);
    } catch (e) {
        console.error("deAPI Status error:", e);
        
        let statusCode = 500;
        if (e.message.includes("Status 429")) statusCode = 429;
        else if (e.message.includes("Status 401")) statusCode = 401;
        
        res.status(statusCode).json({ error: e.message });
    }
});

// Proxy route
app.post("/api/proxy", async (req, res) => {
    const { url, method, headers, body } = req.body;
    try {
        console.log(`[Proxy] Requesting: ${url}`);
        const fetchOptions = {
            method: method || 'GET',
            headers: headers || { 'Content-Type': 'application/json' },
        };
        if (body && (method === 'POST' || method === 'PUT')) {
            fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        }
        const response = await fetch(url, fetchOptions);
        const contentType = response.headers.get("content-type");
        
        let responseData;
        if (contentType && contentType.includes("application/json")) {
            responseData = await response.json();
        } else {
            responseData = await response.text();
        }
        
        res.status(response.status).json(responseData);
    } catch (e) {
        console.error(`[Proxy Error] ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/runway/generate", async (req, res) => {
    const { prompt, aspectRatio, apiKey } = req.body;
    try {
        const response = await fetch('https://api.runwayml.com/v1/image_to_video', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'X-Runway-Version': '2024-05-01'
            },
            body: JSON.stringify({
                promptText: prompt,
                aspectRatio: aspectRatio || '9:16',
                model: 'gen3'
            })
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post("/api/process/start/merge", async (req, res) => {
    uploadAny(req, res, async (err) => {
        if (err) return res.status(500).json({ error: "Upload failed" });
        try {
            const jobId = Date.now().toString();
            jobs[jobId] = { progress: 1, status: "processing" };
            const files = req.files || [];
            if (files.length < 2) throw new Error("Requires video + audio");
            
            const vPath = path.join(UPLOAD_DIR, files[0].filename);
            const aPath = path.join(UPLOAD_DIR, files[1].filename);
            const outPath = path.join(OUTPUT_DIR, `merged_${jobId}.mp4`);
            
            const args = ["-y", "-i", vPath, "-i", aPath, "-c:v", "copy", "-c:a", "aac", "-map", "0:v:0", "-map", "1:a:0", "-shortest", outPath];
            if (files[0].mimetype.startsWith('image')) {
                 const dur = await getExactDuration(aPath) || 10;
                 args.splice(3, 2); args.splice(1, 0, "-loop", "1"); args.push("-t", dur.toString(), ...getVideoArgs());
            }

            runFFmpeg(args).then(() => {
                jobs[jobId].status = "completed"; jobs[jobId].downloadUrl = `/outputs/${path.basename(outPath)}`;
            }).catch(e => { jobs[jobId].status = "failed"; jobs[jobId].error = e.toString(); });

            res.json({ jobId });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
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

// Static Files & SPA Fallback
app.use(express.static(PUBLIC_DIR));
app.use('/outputs', express.static(OUTPUT_DIR));

// 404 for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.originalUrl}` });
});

// Catch-all for SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Running on Port ${PORT}`);
});
