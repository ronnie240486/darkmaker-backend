
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

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

console.log("\n🚀 [BOOT] Iniciando AI Media Suite...");
console.log(`📂 [INFO] Diretório de Trabalho (CWD): ${process.cwd()}`);
console.log(`📂 [INFO] __dirname: ${__dirname}`);

// --- HELPER: Recursively find file ---
// Critical for finding files in nested container structures
function findFile(startDir, filename) {
    if (!fs.existsSync(startDir)) return null;
    try {
        const files = fs.readdirSync(startDir);
        for (const file of files) {
            const fullPath = path.join(startDir, file);
            if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'public') continue;
            
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    const found = findFile(fullPath, filename);
                    if (found) return found;
                } else if (file === filename) {
                    return fullPath;
                }
            } catch (e) {
                // Ignore permission errors etc
            }
        }
    } catch (e) {
        console.warn(`⚠️ Erro lendo diretório ${startDir}: ${e.message}`);
    }
    return null;
}

// --- SETUP PUBLIC DIR ---
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

// --- LOCATE RESOURCES ---
console.log("🔍 [SEARCH] Procurando arquivos de fonte (index.html, index.tsx)...");
const foundHtml = findFile(process.cwd(), 'index.html');
const foundEntry = findFile(process.cwd(), 'index.tsx');

console.log(`   📄 HTML encontrado: ${foundHtml || 'NÃO'}`);
console.log(`   📄 TSX encontrado: ${foundEntry || 'NÃO'}`);

// --- PREPARE INDEX.HTML ---
const publicIndexHtml = path.join(publicDir, 'index.html');

if (foundHtml) {
    try {
        fs.copyFileSync(foundHtml, publicIndexHtml);
        console.log("✅ [SETUP] index.html copiado para public/");
    } catch (e) {
        console.error("❌ [SETUP] Falha ao copiar index.html:", e.message);
    }
} else {
    console.log("⚠️ [WARN] index.html original não encontrado. Gerando fallback.");
    const fallbackHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Media Suite (Recovery)</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script>
        window.process = { env: { NODE_ENV: 'development' } };
        window.global = window;
    </script>
</head>
<body class="bg-black text-white">
    <div id="root">
        <div class="h-screen flex flex-col items-center justify-center p-8 text-center">
            <i class="fas fa-robot text-6xl text-orange-500 mb-6 animate-bounce"></i>
            <h1 class="text-3xl font-bold mb-2">AI Media Suite</h1>
            <p class="text-gray-400">Modo de Recuperação Ativo</p>
            <p class="text-xs text-gray-600 mt-4 max-w-md">O arquivo 'index.html' original não foi encontrado no container. O sistema gerou esta interface temporária para carregar a aplicação.</p>
        </div>
    </div>
    <script type="module" src="/bundle.js"></script>
</body>
</html>`;
    fs.writeFileSync(publicIndexHtml, fallbackHtml);
}

// --- BUILD FRONTEND ---
if (foundEntry) {
    try {
        console.log(`🔨 [BUILD] Compilando Frontend (Entrada: ${foundEntry})...`);
        
        esbuild.buildSync({
            entryPoints: [foundEntry],
            bundle: true,
            outfile: path.join(publicDir, 'bundle.js'),
            format: 'esm',
            target: ['es2020'],
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
    } catch (e) {
        console.error("❌ [BUILD ERROR] Falha crítica no Esbuild:", e.message);
    }
} else {
    console.error("❌ [BUILD ERROR] index.tsx não encontrado. Gerando bundle vazio.");
    const dummyBundle = `
        console.warn("AI Media Suite: index.tsx not found during build.");
        document.getElementById('root').innerHTML = '<div style="color:red;padding:20px;text-align:center"><h1>Erro de Build</h1><p>O arquivo index.tsx não foi encontrado.</p></div>';
    `;
    fs.writeFileSync(path.join(publicDir, 'bundle.js'), dummyBundle);
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
    } else {
        console.warn("⚠️ [FFMPEG] Binários não detectados corretamente.");
    }
} catch (error) {
    console.warn("⚠️ [FFMPEG] Erro config:", error.message);
}

// Middleware
app.use((req, res, next) => {
    if (req.url.startsWith('/api')) {
        console.log(`[NET] ${req.method} ${req.url} - ${new Date().toISOString()}`);
    }
    next();
});

app.use(cors({ origin: '*' })); 
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Static Files
app.use(express.static(publicDir));
app.use(express.static(__dirname));
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

function escapeForDrawtext(text) {
    if (!text) return ' ';
    return text.replace(/\\/g, '\\\\\\\\').replace(/'/g, "'\\\\\\''").replace(/:/g, '\\\\:').replace(/\n/g, ' ');
}

const processScene = async (visualPath, audioPath, text, index, w, h, isImg, duration) => {
    const segPath = path.join(UPLOAD_DIR, `seg_${index}_${Date.now()}.mp4`);
    console.log(`   🎬 [Scene ${index}] Iniciando encode...`);
    
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg();
        const outputDuration = duration || 5;

        cmd.input(visualPath);
        if (isImg) cmd.inputOptions(['-loop 1', `-t ${outputDuration}`]);

        if (audioPath && fs.existsSync(audioPath)) {
            cmd.input(audioPath);
        } else {
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi').inputOptions([`-t ${outputDuration}`]);
        }

        const scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
        let vFilters = [scaleFilter, 'fps=30', 'format=yuv420p'];
        
        if (text && text.length > 0) {
            vFilters.push(`drawtext=text='${escapeForDrawtext(text)}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=h-120:shadowcolor=black:shadowx=2:shadowy=2`);
        }
        vFilters.push('fade=t=in:st=0:d=0.5');

        cmd.complexFilter([
            { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_out' },
            { filter: 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo', inputs: '1:a', outputs: 'a_out' }
        ], ['v_out', 'a_out']);

        cmd.outputOptions(['-c:v libx264', '-preset ultrafast', '-c:a aac', '-shortest', '-y']);

        cmd.on('end', () => resolve(segPath));
        cmd.on('error', (err) => {
            console.error(`   ❌ [Scene ${index}] Erro FFmpeg:`, err.message);
            reject(err);
        });

        cmd.save(segPath);
    });
};

app.post(['/api/ia-turbo', '/api/render'], (req, res) => {
    console.log(`\n📥 [API] START RENDER - Recebendo stream de dados...`);
    
    multiUpload(req, res, async (err) => {
        if (err) {
            console.error("❌ [UPLOAD ERROR]", err);
            return res.status(500).json({ error: "Upload falhou: " + err.message });
        }

        const visualFiles = req.files['visuals'] || [];
        const audioFiles = req.files['audios'] || [];
        const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
        const resolution = req.body.resolution || '1080p';

        console.log(`📦 [UPLOAD COMPLETE] ${visualFiles.length} visuais, ${audioFiles.length} áudios.`);

        try {
            let w = 1920, h = 1080;
            if (resolution === '720p') { w = 1280; h = 720; }
            if (req.body.aspectRatio === '9:16') { const t = w; w = h; h = t; }

            const segments = [];
            for (let i = 0; i < visualFiles.length; i++) {
                segments.push(await processScene(
                    visualFiles[i].path, 
                    audioFiles[i]?.path, 
                    narrations[i], 
                    i, w, h, 
                    visualFiles[i].mimetype.startsWith('image/'),
                    parseInt(req.body.durationPerImage) || 5
                ));
            }

            console.log(`🔗 [CONCAT] Unindo ${segments.length} partes...`);
            const finalName = `MASTER_${Date.now()}.mp4`;
            const finalPath = path.join(OUTPUT_DIR, finalName);
            const listPath = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);
            
            fs.writeFileSync(listPath, segments.map(s => `file '${s}'`).join('\n'));

            await new Promise((resolve, reject) => {
                ffmpeg(listPath)
                    .inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c copy', '-y'])
                    .save(finalPath)
                    .on('end', resolve)
                    .on('error', reject);
            });

            console.log(`✨ [DONE] Vídeo pronto: /outputs/${finalName}`);
            res.json({ url: `/outputs/${finalName}`, status: 'success' });

        } catch (e) {
            console.error("💥 [RENDER ERROR]", e);
            res.status(500).json({ error: e.message });
        }
    });
});

app.post('/api/*', (req, res) => {
    res.json({ url: "https://file-examples.com/storage/fe5554f67366f685c697813/2017/04/file_example_MP4_480_1_5MG.mp4" });
});

// Fallback Route - CRITICAL for preventing 404
app.get('*', (req, res) => {
    console.log(`🔍 [ROUTE] Servindo fallback para: ${req.url}`);
    if (fs.existsSync(publicIndexHtml)) {
        res.sendFile(publicIndexHtml);
    } else {
        res.send("<h1>500 - System Error</h1><p>index.html not generated.</p>");
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ SERVIDOR ONLINE NA PORTA ${PORT}`);
});
