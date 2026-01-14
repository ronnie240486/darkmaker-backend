
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Use API_KEY if set, otherwise fallback or empty string. 
// Note: In production/Veo, keys are often client-side selected.
const GEMINI_KEY = process.env.API_KEY || "";

console.log("\n🚀 [BOOT] Iniciando AI Media Suite...");

// --- SETUP PUBLIC DIR ---
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

// --- RESTORE INDEX.HTML ---
// Ensure index.html exists in public/
const srcHtml = path.join(__dirname, 'index.html');
const destHtml = path.join(publicDir, 'index.html');
if (fs.existsSync(srcHtml)) {
    fs.copyFileSync(srcHtml, destHtml);
} else {
    console.warn("⚠️ index.html original não encontrado na raiz.");
}

// --- BUILD FRONTEND ---
// This step generates the bundle.js from index.tsx
const entryPoint = path.join(__dirname, 'index.tsx');
const bundleOutput = path.join(publicDir, 'bundle.js');

try {
    console.log(`🔨 [BUILD] Compilando Frontend...`);
    
    if (fs.existsSync(entryPoint)) {
        esbuild.buildSync({
            entryPoints: [entryPoint],
            bundle: true,
            outfile: bundleOutput,
            format: 'esm',
            target: ['es2020'],
            // Exclude these libraries from the bundle; they are loaded via importmap in index.html
            external: ['react', 'react-dom', 'react-dom/client', '@google/genai', 'lucide-react', 'fs', 'path', 'fluent-ffmpeg'],
            loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
            define: {
                'process.env.API_KEY': JSON.stringify(GEMINI_KEY),
                'process.env.NODE_ENV': '"development"',
                'global': 'window'
            },
            logLevel: 'info',
        });
        console.log("✅ [BUILD] Frontend compilado com sucesso.");
    } else {
        console.error("❌ [BUILD ERROR] Arquivo de entrada 'index.tsx' não encontrado.");
        fs.writeFileSync(bundleOutput, `console.error("Critical: index.tsx missing");`);
    }
} catch (e) {
    console.error("❌ [BUILD ERROR] Falha crítica no Esbuild:", e.message);
    // Create a valid JS file that logs the error to the browser console
    const errorMsg = e.message.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    fs.writeFileSync(bundleOutput, `
        console.error("Build Failed on Server:\\n${errorMsg}"); 
        document.body.innerHTML = '<div style="color:red; padding:20px; font-family:sans-serif;"><h1>Build Failed</h1><pre>${errorMsg}</pre></div>';
    `);
}

// --- CONFIGURAÇÃO BACKEND ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// FFmpeg Setup
try {
    const ffmpegPath = typeof ffmpegStatic === 'string' ? ffmpegStatic : ffmpegStatic?.path;
    const ffprobePath = typeof ffprobeStatic === 'string' ? ffprobeStatic : ffprobeStatic?.path;
    
    if (ffmpegPath && ffprobePath) {
        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobePath);
        console.log(`🎥 [FFMPEG] Pronto.`);
    }
} catch (error) {
    console.warn("⚠️ [FFMPEG] Erro na configuração dos binários:", error.message);
}

// Middleware
app.use(cors({ origin: '*' })); 
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Static Files
app.use(express.static(publicDir));
app.use('/outputs', express.static(OUTPUT_DIR));

// API Routes
app.get('/api/health', (req, res) => res.json({ status: 'online', port: PORT }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    cb(null, `up_${Date.now()}_${safeName}`);
  }
});
const upload = multer({ 
    storage, 
    limits: { fileSize: 4 * 1024 * 1024 * 1024 } 
});

const multiUpload = upload.fields([{ name: 'visuals' }, { name: 'audios' }]);

// Helper for scene processing (mock logic for demo if ffmpeg fails)
const processScene = async (visualPath, audioPath, text, index, w, h, isImg, duration) => {
    const segPath = path.join(UPLOAD_DIR, `seg_${index}_${Date.now()}.mp4`);
    console.log(`   🎬 [Scene ${index + 1}] Processando...`);
    
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg();
        const outputDuration = duration || 5;

        cmd.input(visualPath);
        if (isImg) cmd.inputOptions(['-loop 1', `-t ${outputDuration}`]);

        if (audioPath && fs.existsSync(audioPath) && fs.statSync(audioPath).size > 100) {
            cmd.input(audioPath);
        } else {
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi').inputOptions([`-t ${outputDuration}`]);
        }

        const scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
        let vFilters = [scaleFilter, 'fps=30', 'format=yuv420p'];

        cmd.complexFilter([
            { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_out' },
            { filter: 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo', inputs: '1:a', outputs: 'a_out' }
        ], ['v_out', 'a_out']);

        cmd.outputOptions(['-c:v libx264', '-preset ultrafast', '-c:a aac', '-shortest', `-t ${outputDuration}`, '-y']);

        cmd.on('end', () => resolve(segPath));
        cmd.on('error', (err) => {
            console.error(`   ❌ [Scene ${index + 1}] Erro FFmpeg:`, err.message);
            // Non-blocking reject (in production, handle fallback)
            reject(err);
        });

        cmd.save(segPath);
    });
};

app.post(['/api/ia-turbo', '/api/render'], (req, res) => {
    multiUpload(req, res, async (err) => {
        if (err) return res.status(500).json({ error: "Upload falhou: " + err.message });

        const visualFiles = req.files['visuals'] || [];
        const audioFiles = req.files['audios'] || [];
        const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
        const durationPerImage = parseInt(req.body.durationPerImage) || 5;

        try {
            // Processing logic placeholder - in a real scenario, this would chain ffmpeg commands
            // For now, we simulate success or return the first file as echo
            if (visualFiles.length > 0) {
                // If FFMPEG is working, we would return the result of processScene loop.
                // Fallback for demo stability:
                res.json({ url: `/outputs/demo_output.mp4`, status: 'simulated' });
            } else {
                res.status(400).json({ error: "No files provided" });
            }
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

app.post('/api/*', (req, res) => {
    res.json({ url: "https://file-examples.com/storage/fe5554f67366f685c697813/2017/04/file_example_MP4_480_1_5MG.mp4" });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ SERVIDOR ONLINE NA PORTA ${PORT}`);
});
