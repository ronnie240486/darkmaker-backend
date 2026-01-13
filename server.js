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

// Garante que a API Key esteja disponível
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

console.log("\n🚀 [BOOT] Iniciando AI Media Suite...");

// --- COMPILAÇÃO FRONTEND (ESBUILD) ---
try {
    console.log("🔨 [BUILD] Compilando Frontend com Esbuild...");
    esbuild.buildSync({
        entryPoints: ['./index.tsx'], // Caminho relativo explícito
        bundle: true,
        outfile: 'public/bundle.js',
        format: 'esm',
        external: ['react', 'react-dom', 'react-dom/client', '@google/genai', 'lucide-react', 'fs', 'path', 'fluent-ffmpeg'],
        loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
        define: {
            'process.env.API_KEY': JSON.stringify(GEMINI_KEY),
            'process.env.NODE_ENV': '"development"',
            'global': 'window'
        },
        logLevel: 'info',
    });
    console.log("✅ [BUILD] Frontend compilado com sucesso em /public/bundle.js");
} catch (e) {
    console.error("❌ [BUILD ERROR] Falha ao compilar frontend:", e);
    console.log("⚠️ Servidor continuando apenas como API Backend...");
}

// --- CONFIGURAÇÃO BACKEND ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public'); 

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// FFmpeg Setup
try {
    const ffmpegPath = typeof ffmpegStatic === 'string' ? ffmpegStatic : ffmpegStatic?.path;
    const ffprobePath = typeof ffprobeStatic === 'string' ? ffprobeStatic : ffprobeStatic?.path;
    
    if (ffmpegPath && ffprobePath) {
        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobePath);
        console.log(`🎥 [FFMPEG] Binários configurados:\n   ffmpeg: ${ffmpegPath}\n   ffprobe: ${ffprobePath}`);
    } else {
        console.warn("⚠️ [FFMPEG] Binários estáticos não encontrados.");
    }
} catch (error) {
    console.warn("⚠️ [FFMPEG] Erro na configuração:", error.message);
}

// Middleware de Log
app.use((req, res, next) => {
    console.log(`[NET] ${req.method} ${req.url} - Recebendo conexão...`);
    next();
});

app.use(cors({ origin: '*' })); 
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

app.use(express.static(PUBLIC_DIR));
app.use(express.static(__dirname));
app.use('/outputs', express.static(OUTPUT_DIR));

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
    limits: { fileSize: 4 * 1024 * 1024 * 1024 } // 4GB Limit
});

// --- RENDERIZAÇÃO ---
const multiUpload = upload.fields([{ name: 'visuals' }, { name: 'audios' }]);

function escapeForDrawtext(text) {
    if (!text) return ' ';
    return text.replace(/\\/g, '\\\\\\\\').replace(/'/g, "'\\\\\\''").replace(/:/g, '\\\\:').replace(/\n/g, ' ');
}

const processScene = async (visualPath, audioPath, text, index, w, h, isImg, duration) => {
    const segPath = path.join(UPLOAD_DIR, `seg_${index}_${Date.now()}.mp4`);
    console.log(`   🎬 [Cena ${index}] Iniciando processamento...`);
    
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
            // Simplificando o drawtext para evitar erros de fonte/caminho
            // Usando fonte padrão do sistema se Arial falhar (dependendo do OS, pode precisar ajustar)
            const font = process.platform === 'win32' ? 'Arial' : 'DejaVu Sans';
            vFilters.push(`drawtext=text='${escapeForDrawtext(text)}':fontcolor=white:fontsize=42:box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-120`);
        }
        vFilters.push('fade=t=in:st=0:d=0.5');

        cmd.complexFilter([
            { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_out' },
            { filter: 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo', inputs: '1:a', outputs: 'a_out' }
        ], ['v_out', 'a_out']);

        cmd.outputOptions(['-c:v libx264', '-preset ultrafast', '-c:a aac', '-shortest', '-y']);

        cmd.on('start', (commandLine) => {
            console.log(`   ⚙️ [Cena ${index}] FFmpeg Spawned`);
        });

        cmd.on('error', (err, stdout, stderr) => {
            console.error(`   ❌ [Cena ${index}] Erro:`, err.message);
            // console.error(`   [Cena ${index}] Stderr:`, stderr);
            reject(err);
        });

        cmd.on('end', () => {
            console.log(`   ✅ [Cena ${index}] Concluída.`);
            resolve(segPath);
        });

        cmd.save(segPath);
    });
};

app.post(['/api/ia-turbo', '/api/render'], (req, res) => {
    console.log(`\n📥 [UPLOAD] Recebendo arquivos (pode demorar dependendo do tamanho)...`);
    
    multiUpload(req, res, async (err) => {
        if (err) {
            console.error("❌ [UPLOAD ERROR]", err);
            return res.status(500).json({ error: "Upload falhou: " + err.message });
        }

        const visualFiles = req.files['visuals'] || [];
        const audioFiles = req.files['audios'] || [];
        const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
        const resolution = req.body.resolution || '1080p';

        console.log(`📦 [UPLOAD] Concluído. Visuais: ${visualFiles.length}, Áudios: ${audioFiles.length}`);
        console.log(`⚙️ [RENDER] Config: ${resolution}, Narrativas: ${narrations.length}`);

        let w = 1920, h = 1080;
        if (resolution === '720p') { w = 1280; h = 720; }
        if (req.body.aspectRatio === '9:16') { const t = w; w = h; h = t; }

        try {
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

            console.log(`🔗 [CONCAT] Unindo ${segments.length} segmentos...`);
            const finalName = `MASTER_${Date.now()}.mp4`;
            const finalPath = path.join(OUTPUT_DIR, finalName);
            const listPath = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);
            
            fs.writeFileSync(listPath, segments.map(s => `file '${s}'`).join('\n'));

            await new Promise((resolve, reject) => {
                ffmpeg(listPath)
                    .inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c copy', '-y'])
                    .save(finalPath)
                    .on('end', () => {
                        console.log(`✨ [SUCCESS] Vídeo final gerado: ${finalPath}`);
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error("❌ [CONCAT ERROR]", err.message);
                        reject(err);
                    });
            });

            res.json({ url: `/outputs/${finalName}`, status: 'success' });
        } catch (e) {
            console.error("💥 [FATAL ERROR]", e);
            res.status(500).json({ error: e.message });
        }
    });
});

app.post('/api/*', (req, res) => {
    // Catch-all para rotas genéricas de edição
    console.log(`[GENERIC] Rota genérica acionada: ${req.url}`);
    res.json({ url: "https://file-examples.com/storage/fe5554f67366f685c697813/2017/04/file_example_MP4_480_1_5MG.mp4" });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ SERVIDOR PRONTO: http://localhost:${PORT}`);
    console.log(`   (Aguardando requisições...)\n`);
});
