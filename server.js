
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

console.log("\n🚀 [BOOT] Iniciando AI Media Suite Backend...");

// --- CONFIGURATION ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure directories exist
[UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- FFMPEG SETUP ---
try {
    const ffmpegPath = typeof ffmpegStatic === 'string' ? ffmpegStatic : ffmpegStatic?.path;
    const ffprobePath = typeof ffprobeStatic === 'string' ? ffprobeStatic : ffprobeStatic?.path;
    
    if (ffmpegPath && ffprobePath) {
        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobePath);
        console.log(`🎥 [FFMPEG] Binários configurados: ${ffmpegPath}`);
    } else {
        console.warn("⚠️ [FFMPEG] Binários estáticos não encontrados.");
    }
} catch (error) {
    console.warn("⚠️ [FFMPEG] Erro na configuração:", error.message);
}

// --- BUILD FRONTEND ---
const entryPoint = path.join(__dirname, 'index.tsx');
if (fs.existsSync(entryPoint) && !fs.existsSync(path.join(PUBLIC_DIR, 'bundle.js'))) {
    console.log("🔨 [BUILD] Compilando Frontend...");
    try {
        esbuild.buildSync({
            entryPoints: [entryPoint],
            bundle: true,
            outfile: path.join(PUBLIC_DIR, 'bundle.js'),
            format: 'esm',
            target: ['es2020'],
            external: ['react', 'react-dom', 'react-dom/client', '@google/genai', 'lucide-react', 'fs', 'path', 'fluent-ffmpeg'],
            loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
            define: { 'process.env.API_KEY': JSON.stringify(GEMINI_KEY), 'global': 'window' },
        });
        if (fs.existsSync('index.html')) fs.copyFileSync('index.html', path.join(PUBLIC_DIR, 'index.html'));
    } catch (e) { console.error("❌ Build falhou:", e.message); }
}

// --- MIDDLEWARE ---
app.use(cors({ origin: '*' })); 
app.use(express.json({ limit: '1gb' }));
app.use(express.urlencoded({ extended: true, limit: '1gb' }));

// Static Files
app.use(express.static(PUBLIC_DIR));
app.use('/outputs', express.static(OUTPUT_DIR));

// --- UPLOAD CONFIG ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    cb(null, `${Date.now()}_${safeName}`);
  }
});

const upload = multer({ 
    storage, 
    limits: { fileSize: 1024 * 1024 * 1024 } // 1GB limit
});

const multiUpload = upload.fields([{ name: 'visuals' }, { name: 'audios' }]);

// --- HELPERS ---

const getMediaDuration = (filePath) => {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return resolve(5);
            resolve(metadata.format.duration || 5);
        });
    });
};

const processScene = async (visualPath, audioPath, index, resolutionConfig) => {
    const segPath = path.join(UPLOAD_DIR, `segment_${index}_${Date.now()}.mp4`);
    const { w, h } = resolutionConfig;
    
    let duration = 5;
    if (audioPath) {
        duration = await getMediaDuration(audioPath);
    }
    duration = parseFloat(duration) + 0.1;

    console.log(`   🎬 [Cena ${index}] Renderizando... (In: ${path.basename(visualPath)}, Dur: ${duration.toFixed(2)}s)`);

    return new Promise((resolve, reject) => {
        const cmd = ffmpeg();
        const isImage = visualPath.match(/\.(jpg|jpeg|png|webp)$/i);
        
        cmd.input(visualPath);
        if (isImage) cmd.inputOptions(['-loop 1']); 

        if (audioPath && fs.existsSync(audioPath)) {
            cmd.input(audioPath);
        } else {
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi');
        }

        const vFilters = [
            `scale=${w}:${h}:force_original_aspect_ratio=increase`,
            `crop=${w}:${h}`,
            'fps=30',
            'format=yuv420p'
        ];
        
        const aFilters = ['aresample=44100', 'aformat=sample_fmts=fltp:channel_layouts=stereo'];

        cmd.complexFilter([
            { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_out' },
            { filter: aFilters.join(','), inputs: '1:a', outputs: 'a_out' }
        ], ['v_out', 'a_out']);

        cmd.outputOptions([
            '-c:v libx264', '-preset ultrafast', '-pix_fmt yuv420p',
            '-c:a aac', '-b:a 192k',
            '-t', `${duration}`,
            '-shortest',
            '-y'
        ]);

        cmd.save(segPath)
           .on('end', () => resolve(segPath))
           .on('error', (err) => {
               console.error(`   ❌ [Cena ${index}] Falha no FFmpeg:`, err.message);
               reject(err);
           });
    });
};

// --- ROUTES ---

app.get('/api/health', (req, res) => {
    console.log("💓 Health check received");
    res.json({ status: 'online', engine: 'ffmpeg-static' });
});

app.post('/api/render', (req, res) => {
    console.log(`\n📥 [RENDER] Recebendo arquivos...`);

    multiUpload(req, res, async (err) => {
        if (err) {
            console.error("❌ Erro no upload (Multer):", err);
            return res.status(500).json({ error: "Upload failed: " + err.message });
        }

        const visuals = req.files['visuals'] || [];
        const audios = req.files['audios'] || [];
        const resolution = req.body.resolution || '1080p';
        
        console.log(`📦 Dados recebidos: ${visuals.length} visuais, ${audios.length} áudios.`);

        if (visuals.length === 0) {
            return res.status(400).json({ error: "Nenhum arquivo visual recebido." });
        }

        let w = 1920, h = 1080;
        if (resolution === '720p') { w = 1280; h = 720; }
        // Se for 9:16 (shorts), inverte
        if (req.body.aspectRatio === '9:16') { [w, h] = [h, w]; }

        try {
            const segmentPaths = [];

            for (let i = 0; i < visuals.length; i++) {
                const visual = visuals[i];
                const audio = audios[i] || null; 
                try {
                    const segment = await processScene(visual.path, audio ? audio.path : null, i, { w, h });
                    segmentPaths.push(segment);
                } catch (sceneErr) {
                    console.error(`Pular cena ${i} devido a erro:`, sceneErr);
                }
            }

            if (segmentPaths.length === 0) throw new Error("Nenhum segmento foi gerado com sucesso.");

            console.log(`🔗 [CONCAT] Unindo ${segmentPaths.length} segmentos...`);
            
            const listPath = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);
            const finalFilename = `MASTER_${Date.now()}.mp4`;
            const finalPath = path.join(OUTPUT_DIR, finalFilename);

            const listContent = segmentPaths.map(p => `file '${p}'`).join('\n');
            fs.writeFileSync(listPath, listContent);

            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(listPath)
                    .inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c copy', '-y'])
                    .save(finalPath)
                    .on('end', resolve)
                    .on('error', reject);
            });

            // Cleanup
            setTimeout(() => {
                [...segmentPaths, listPath, ...visuals.map(f=>f.path), ...audios.map(f=>f.path)]
                .forEach(p => { if(fs.existsSync(p)) fs.unlinkSync(p); });
            }, 10000);

            console.log(`✅ [SUCESSO] Vídeo gerado: /outputs/${finalFilename}`);
            res.json({ url: `/outputs/${finalFilename}`, status: 'success' });

        } catch (error) {
            console.error("💥 [ERRO FATAL NO SERVIDOR]", error);
            res.status(500).json({ error: "Falha na renderização: " + error.message });
        }
    });
});

app.get('*', (req, res) => {
    const index = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(index)) res.sendFile(index);
    else res.send("<h1>Server Online</h1><p>Frontend is building or missing.</p>");
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🟢 SERVER ONLINE: http://localhost:${PORT}`);
});
