import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURAÇÃO DO FFMPEG ---
console.log("\n🎥 [SERVER] INICIALIZANDO ENGINE DE VÍDEO (PORTA 3000)...");
try {
    const ffmpegPath = typeof ffmpegStatic === 'string' ? ffmpegStatic : ffmpegStatic?.path;
    const ffprobePath = typeof ffprobeStatic === 'string' ? ffprobeStatic : ffprobeStatic?.path;

    if (!ffmpegPath || !ffprobePath) throw new Error("Binários do FFmpeg não encontrados.");

    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
    console.log(`✅ [SERVER] FFmpeg Configurado: ${ffmpegPath}`);
} catch (error) {
    console.error("❌ [SERVER] ERRO CRÍTICO FFmpeg:", error.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const DIST_DIR = path.join(__dirname, 'dist'); 

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Configuração CORS Permissiva para evitar bloqueios entre portas locais
app.use(cors({ origin: '*' })); 
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// 1. Servir Arquivos Estáticos do Frontend (Se existirem)
if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
}

// 2. Servir Outputs de Vídeo (Público)
app.use('/outputs', express.static(OUTPUT_DIR));

// 3. API Health Check
app.get('/api/health', (req, res) => res.status(200).json({ status: 'online', port: PORT }));

// --- UPLOAD CONFIG ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    cb(null, `up_${Date.now()}_${safeName}`);
  }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 4 * 1024 * 1024 * 1024 } 
});

// --- FUNÇÕES FFMPEG ---

function escapeForDrawtext(text) {
    if (!text) return ' ';
    return text.replace(/\\/g, '\\\\\\\\').replace(/'/g, "'\\\\\\''").replace(/:/g, '\\\\:').replace(/\n/g, ' ');
}

const processScene = async (visualPath, audioPath, text, index, w, h, isImg, duration) => {
    const segPath = path.join(UPLOAD_DIR, `seg_${index}_${Date.now()}.mp4`);
    console.log(`   🔨 [Cena ${index + 1}] Iniciando renderização...`);
    
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg();
        const outputDuration = duration || 5;

        // Inputs
        cmd.input(visualPath);
        if (isImg) cmd.inputOptions(['-loop 1', `-t ${outputDuration}`]);

        if (audioPath && fs.existsSync(audioPath)) {
            cmd.input(audioPath);
        } else {
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi').inputOptions([`-t ${outputDuration}`]);
        }

        // Filtros
        const scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
        let vFilters = [scaleFilter, 'fps=30', 'format=yuv420p'];
        
        if (text && text.length > 0 && text !== 'undefined' && text !== 'null') {
            const sanitizedText = escapeForDrawtext(text);
            vFilters.push(`drawtext=text='${sanitizedText}':fontcolor=white:fontsize=42:box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-120:fontfile='Arial'`);
        }
        
        vFilters.push('fade=t=in:st=0:d=0.5');

        cmd.complexFilter([
            { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_out' },
            { filter: 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo', inputs: '1:a', outputs: 'a_out' }
        ], ['v_out', 'a_out']);

        cmd.outputOptions([
            '-c:v libx264', '-preset ultrafast', '-crf 26', 
            '-c:a aac', '-b:a 128k', 
            '-shortest', '-movflags +faststart', '-y'
        ]);

        cmd.save(segPath)
        .on('end', () => {
            console.log(`   ✅ [Cena ${index + 1}] Renderizada.`);
            resolve(segPath);
        })
        .on('error', (err) => {
            console.error(`   ❌ [Cena ${index + 1}] Falha:`, err.message);
            reject(err);
        });
    });
};

const multiUpload = upload.fields([{ name: 'visuals' }, { name: 'audios' }]);

// --- ROTA DE RENDERIZAÇÃO ---
app.post(['/api/ia-turbo', '/api/render'], (req, res) => {
    console.log("\n📥 [RENDER] Nova solicitação recebida no Backend.");
    
    multiUpload(req, res, async (err) => {
        if (err) {
            console.error("❌ Erro de Upload:", err);
            return res.status(500).json({ error: "Falha no upload." });
        }

        const visualFiles = req.files['visuals'] || [];
        const audioFiles = req.files['audios'] || [];
        let narrations = [];
        try { narrations = req.body.narrations ? JSON.parse(req.body.narrations) : []; } catch(e) {}

        const resolution = req.body.resolution || '1080p';
        console.log(`📦 Processando ${visualFiles.length} cenas em ${resolution}...`);

        let w = 1920, h = 1080;
        if (req.body.resolution === '720p') { w = 1280; h = 720; }
        if (req.body.aspectRatio === '9:16') { const t = w; w = h; h = t; }

        const finalOutputName = `MASTER_${Date.now()}.mp4`;
        const finalOutputPath = path.join(OUTPUT_DIR, finalOutputName);
        const segments = [];

        try {
            for (let i = 0; i < visualFiles.length; i++) {
                const seg = await processScene(
                    visualFiles[i].path, 
                    audioFiles[i]?.path, 
                    narrations[i], 
                    i, w, h, 
                    visualFiles[i].mimetype.startsWith('image/'),
                    parseInt(req.body.durationPerImage) || 5
                );
                segments.push(seg);
            }

            console.log("🔗 Concatenando Master...");
            const listPath = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);
            const fileContent = segments.map(s => `file '${s}'`).join('\n');
            fs.writeFileSync(listPath, fileContent);

            await new Promise((resolve, reject) => {
                ffmpeg(listPath)
                    .inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c copy', '-y'])
                    .save(finalOutputPath)
                    .on('end', resolve)
                    .on('error', reject);
            });

            console.log(`🎉 [SUCESSO] Vídeo gerado: ${finalOutputName}`);
            res.json({ url: `/outputs/${finalOutputName}`, status: 'success' });

        } catch (error) {
            console.error("❌ ERRO FATAL:", error);
            res.status(500).json({ error: error.message });
        }
    });
});

app.get('*', (req, res) => {
    if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
        res.sendFile(path.join(DIST_DIR, 'index.html'));
    } else {
        res.status(404).send("API Backend Rodando. Frontend não buildado.");
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SERVIDOR ON NA PORTA ${PORT}`);
});
