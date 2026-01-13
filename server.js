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
console.log(`📂 [INFO] Diretório de Trabalho: ${process.cwd()}`);
console.log(`📂 [INFO] __dirname: ${__dirname}`);

// --- DEBUG: LIST FILES ---
try {
    const files = fs.readdirSync(__dirname);
    console.log("🗂️ [DEBUG] Arquivos na raiz:", files.filter(f => !f.startsWith('node_modules')));
} catch (e) {
    console.error("❌ [DEBUG ERROR] Não foi possível listar arquivos:", e.message);
}

// --- COMPILAÇÃO FRONTEND (ESBUILD) ---
// Tenta localizar o index.tsx em vários locais possíveis
const possibleEntryPoints = [
    path.join(__dirname, 'index.tsx'),
    path.join(process.cwd(), 'index.tsx'),
    './index.tsx'
];

let entryPoint = possibleEntryPoints.find(p => fs.existsSync(p));

if (entryPoint) {
    try {
        console.log(`🔨 [BUILD] Compilando Frontend (Entrada: ${entryPoint})...`);
        
        // Garante que a pasta public existe
        if (!fs.existsSync(path.join(__dirname, 'public'))) {
            fs.mkdirSync(path.join(__dirname, 'public'));
        }

        esbuild.buildSync({
            entryPoints: [entryPoint],
            bundle: true,
            outfile: path.join(__dirname, 'public', 'bundle.js'),
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
    console.error("❌ [BUILD ERROR] Arquivo index.tsx NÃO ENCONTRADO em nenhum dos locais esperados.");
    console.log("⚠️ O servidor continuará rodando, mas a interface pode não carregar.");
}

// --- CONFIGURAÇÃO BACKEND ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public'); 

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

// Middleware de Log Genérico (Antes de tudo)
app.use((req, res, next) => {
    // Ignora requests de estáticos comuns para não poluir o log
    if (!req.url.includes('.js') && !req.url.includes('.css') && !req.url.includes('.ico')) {
        console.log(`[NET] ${req.method} ${req.url}`);
    }
    next();
});

app.use(cors({ origin: '*' })); 
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

app.use(express.static(PUBLIC_DIR));
app.use(express.static(__dirname));
app.use('/outputs', express.static(OUTPUT_DIR));

// Rota de Health Check para o Frontend validar conexão
app.get('/api/health', (req, res) => res.json({ status: 'online', port: PORT }));

// --- UPLOAD CONFIG ---
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

// --- RENDERIZAÇÃO ---
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
            // Fonte fallback simples
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
    console.log(`\n📥 [API] Requisição de Renderização Recebida. Iniciando Upload...`);
    
    multiUpload(req, res, async (err) => {
        if (err) {
            console.error("❌ [UPLOAD ERROR]", err);
            return res.status(500).json({ error: "Upload falhou: " + err.message });
        }

        const visualFiles = req.files['visuals'] || [];
        const audioFiles = req.files['audios'] || [];
        const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
        const resolution = req.body.resolution || '1080p';

        console.log(`📦 [UPLOAD OK] ${visualFiles.length} visuais recebidos.`);

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

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ SERVIDOR ONLINE NA PORTA ${PORT}`);
});
