
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

console.log("\x1b[36m%s\x1b[0m", "\n🚀 [BOOT] Iniciando Servidor Multimídia AI Suite (Ultimate Edition)...");

// --- CONFIGURATION ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Cleanup old files on boot
if (fs.existsSync(UPLOAD_DIR)) fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
[UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- FFMPEG SETUP ---
try {
    // ffmpeg-static retorna o caminho string
    const ffmpegPath = ffmpegStatic; 
    const ffprobePath = ffprobeStatic.path;
    
    if (ffmpegPath && ffprobePath) {
        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobePath);
        console.log(`🎥 [FFMPEG] Binários Carregados.`);
    } else {
        console.error("⚠️ [FFMPEG] Binários não encontrados! O processamento de vídeo falhará.");
    }
} catch (error) {
    console.error("⚠️ [FFMPEG] Erro Config:", error.message);
}

// --- BUILD FRONTEND ---
const entryPoint = path.join(__dirname, 'index.tsx');
if (fs.existsSync(entryPoint) && !fs.existsSync(path.join(PUBLIC_DIR, 'bundle.js'))) {
    console.log("🔨 [BUILD] Compilando React App...");
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
    } catch (e) { console.error("❌ Build Failed:", e.message); }
}

// --- MIDDLEWARE ---
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1gb' }));
app.use(express.urlencoded({ extended: true, limit: '1gb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/outputs', express.static(OUTPUT_DIR));

// --- UPLOAD HANDLER ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safeName = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    cb(null, `${uniqueSuffix}_${safeName}`);
  }
});
const upload = multer({ 
    storage, 
    limits: { fileSize: 2048 * 1024 * 1024 } // 2GB
});

// Configure different upload fields for different routes
const uploadRender = upload.fields([{ name: 'visuals' }, { name: 'audios' }]);
const uploadGeneric = upload.any(); // Aceita qualquer campo para ferramentas genéricas

// --- PROCESSING HELPERS ---

const getDuration = (filePath) => {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) resolve(5);
            else resolve(metadata.format.duration || 5);
        });
    });
};

// Padroniza QUALQUER input para um formato intermediário idêntico para concatenação perfeita
const normalizeScene = (visualPath, audioPath, index, width, height) => {
    return new Promise(async (resolve, reject) => {
        const outPath = path.join(UPLOAD_DIR, `norm_${index}_${Date.now()}.mp4`);
        let duration = 5;
        
        if (audioPath) duration = await getDuration(audioPath);
        duration = parseFloat(duration) + 0.1; // Padding para evitar cortes abruptos no áudio

        console.log(`   ⚙️ Processando Cena ${index}: ${path.basename(visualPath)} (${duration.toFixed(1)}s)`);

        const cmd = ffmpeg();
        
        // Input Visual
        const isImage = visualPath.match(/\.(jpg|jpeg|png|webp|gif)$/i);
        cmd.input(visualPath);
        if (isImage) cmd.inputOptions(['-loop 1']);

        // Input Audio
        if (audioPath && fs.existsSync(audioPath)) {
            cmd.input(audioPath);
        } else {
            // Gera silêncio se não houver áudio
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi');
        }

        // Filtros Complexos: Scale, Crop, FPS, Pixel Format, Audio Resample
        // Isso garante que todos os pedaços tenham EXATAMENTE a mesma codificação
        const vFilters = [
            `scale=${width}:${height}:force_original_aspect_ratio=increase`,
            `crop=${width}:${height}`,
            'fps=30',
            'format=yuv420p'
        ];
        
        cmd.complexFilter([
            `[0:v]${vFilters.join(',')}[v]`,
            `[1:a]aresample=44100,aformat=channel_layouts=stereo[a]`
        ], ['v', 'a']);

        cmd.outputOptions([
            '-c:v libx264', '-preset ultrafast', '-tune stillimage',
            '-c:a aac', '-b:a 192k',
            '-shortest', // Corta vídeo se áudio acabar
            '-t', `${duration}`, // Força duração máxima
            '-movflags +faststart'
        ]);

        cmd.save(outPath)
           .on('end', () => resolve(outPath))
           .on('error', (err) => {
               console.error(`   ❌ Falha cena ${index}:`, err.message);
               reject(err);
           });
    });
};

// --- ROUTES ---

app.get('/api/health', (req, res) => res.json({ status: 'online', msg: 'Media Engine Active' }));

// 1. MAIN RENDER ROUTE (IA Turbo / Magic Workflow)
app.post('/api/render', (req, res) => {
    uploadRender(req, res, async (err) => {
        if (err) {
            console.error("Upload Error:", err);
            return res.status(500).json({ error: "Upload failed: " + err.message });
        }

        console.log("\n🎬 [RENDER] Iniciando Job de Renderização...");
        const visuals = req.files['visuals'] || [];
        const audios = req.files['audios'] || [];
        
        if (!visuals.length) return res.status(400).json({ error: "Nenhum arquivo visual recebido." });

        // Configuração de Resolução
        const resolution = req.body.resolution || '1080p';
        const ratio = req.body.aspectRatio || '16:9';
        let w = 1920, h = 1080;
        
        if (resolution === '720p') { w = 1280; h = 720; }
        if (ratio === '9:16') { [w, h] = [h, w]; } // Portrait swap

        console.log(`   Config: ${w}x${h} | Cenas: ${visuals.length}`);

        try {
            const segments = [];
            
            // Fase 1: Normalização (Sequencial para evitar sobrecarga de CPU)
            for (let i = 0; i < visuals.length; i++) {
                const vis = visuals[i];
                const aud = audios[i] || null;
                try {
                    const seg = await normalizeScene(vis.path, aud ? aud.path : null, i, w, h);
                    segments.push(seg);
                } catch (sceneErr) {
                    console.error(`Pular cena ${i} devido a erro de processamento.`);
                }
            }

            if(segments.length === 0) throw new Error("Nenhuma cena pôde ser processada.");

            // Fase 2: Concatenação
            console.log(`   🔗 Unindo ${segments.length} segmentos...`);
            const listPath = path.join(UPLOAD_DIR, `concat_list_${Date.now()}.txt`);
            const finalName = `MASTER_${Date.now()}.mp4`;
            const finalPath = path.join(OUTPUT_DIR, finalName);

            const listContent = segments.map(p => `file '${p}'`).join('\n');
            fs.writeFileSync(listPath, listContent);

            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(listPath)
                    .inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c copy', '-y']) // Copy stream pois já normalizamos
                    .save(finalPath)
                    .on('end', resolve)
                    .on('error', reject);
            });

            console.log(`   ✅ Sucesso! URL: /outputs/${finalName}`);
            
            // Limpeza Assíncrona
            setTimeout(() => {
                [listPath, ...segments, ...visuals.map(f=>f.path), ...audios.map(f=>f.path)].forEach(p => {
                    if (fs.existsSync(p)) fs.unlinkSync(p);
                });
            }, 10000);

            res.json({ url: `/outputs/${finalName}`, status: 'success' });

        } catch (error) {
            console.error("   💥 Erro Fatal Render:", error);
            res.status(500).json({ error: error.message });
        }
    });
});

// 2. AUDIO PROCESSING ROUTE
app.post('/api/audio-process', (req, res) => {
    uploadGeneric(req, res, async (err) => {
        if (err) return res.status(500).json({ error: err.message });
        console.log("\n🎵 [AUDIO] Processando Requisição...");
        
        const files = req.files || [];
        const action = req.body.action || 'convert';
        
        if (!files.length) return res.status(400).json({ error: "Sem áudio." });

        try {
            const outName = `AUDIO_${action}_${Date.now()}.mp3`; 
            const outPath = path.join(OUTPUT_DIR, outName);
            const cmd = ffmpeg();

            if (action === 'join') {
                console.log(`   Unindo ${files.length} arquivos de áudio...`);
                files.forEach(f => cmd.input(f.path));
                cmd.mergeToFile(outPath, path.join(__dirname, 'temp'))
                   .on('end', () => res.json({ url: `/outputs/${outName}` }))
                   .on('error', (e) => res.status(500).json({ error: e.message }));
            } else if (action === 'cut') {
                console.log("   Cortando áudio...");
                cmd.input(files[0].path)
                   .setStartTime(0).setDuration(15) // Exemplo simplificado
                   .save(outPath)
                   .on('end', () => res.json({ url: `/outputs/${outName}` }))
                   .on('error', (e) => res.status(500).json({ error: e.message }));
            } else {
                // Convert default
                console.log("   Convertendo para MP3...");
                cmd.input(files[0].path)
                   .toFormat('mp3')
                   .save(outPath)
                   .on('end', () => res.json({ url: `/outputs/${outName}` }))
                   .on('error', (e) => res.status(500).json({ error: e.message }));
            }
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

// 3. IMAGE PROCESSING ROUTE
app.post('/api/image-process', (req, res) => {
    uploadGeneric(req, res, async (err) => {
        if (err) return res.status(500).json({ error: err.message });
        console.log("\n🖼️ [IMAGE] Processando...");
        
        const files = req.files || [];
        if (!files.length) return res.status(400).json({ error: "Sem imagem." });

        try {
            const outName = `IMG_${Date.now()}.png`;
            const outPath = path.join(OUTPUT_DIR, outName);
            
            // Simple Conversion/Resize via FFmpeg (supports images well)
            ffmpeg(files[0].path)
                .outputOptions(['-vf scale=1080:-1'])
                .save(outPath)
                .on('end', () => res.json({ url: `/outputs/${outName}` }))
                .on('error', (e) => res.status(500).json({ error: e.message }));

        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

// 4. GENERIC VIDEO TOOLS (Cut, Compress, etc.)
app.post('/api/:tool', (req, res) => {
    uploadGeneric(req, res, async (err) => {
        if (err) return res.status(500).json({ error: err.message });
        const tool = req.params.tool;
        console.log(`\n🔧 [TOOL] Executando Ferramenta: ${tool}`);
        
        const files = req.files || [];
        if (!files.length) return res.status(400).json({ error: "Sem arquivos." });

        try {
            const outName = `${tool.toUpperCase()}_${Date.now()}.mp4`;
            const outPath = path.join(OUTPUT_DIR, outName);
            const cmd = ffmpeg(files[0].path);

            switch(tool) {
                case 'compress':
                    cmd.videoCodec('libx264').outputOptions(['-crf 28']);
                    break;
                case 'cut':
                    cmd.setStartTime(0).setDuration(10);
                    break;
                case 'upscale':
                    cmd.videoFilters('scale=3840:-1:flags=lanczos');
                    break;
                case 'extract-audio':
                    const audName = `EXTRACT_${Date.now()}.mp3`;
                    const audPath = path.join(OUTPUT_DIR, audName);
                    cmd.noVideo().save(audPath)
                        .on('end', () => res.json({ url: `/outputs/${audName}` }))
                        .on('error', (e) => res.status(500).json({ error: e.message }));
                    return; 
                default:
                    cmd.outputOptions(['-c copy']); 
            }

            cmd.save(outPath)
               .on('end', () => res.json({ url: `/outputs/${outName}` }))
               .on('error', (e) => res.status(500).json({ error: e.message }));

        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

// --- SPA FALLBACK ---
app.get('*', (req, res) => {
    const index = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(index)) res.sendFile(index);
    else res.send("<h1>Server Online</h1><p>Frontend building... Refresh in a moment.</p>");
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🟢 SERVER LISTENING: http://localhost:${PORT}`);
    console.log(`   Ready to process all media requests.`);
});
