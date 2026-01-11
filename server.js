import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURAÇÃO DO FFMPEG ---
console.log("\n🎥 [BACKEND] INICIALIZANDO ENGINE DE VÍDEO...");
try {
    const ffmpegPath = typeof ffmpegStatic === 'string' ? ffmpegStatic : ffmpegStatic?.path;
    const ffprobePath = typeof ffprobeStatic === 'string' ? ffprobeStatic : ffprobeStatic?.path;

    if (!ffmpegPath || !ffprobePath) throw new Error("Binários do FFmpeg não encontrados.");

    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
    console.log(`✅ [BACKEND] FFmpeg Configurado: ${ffmpegPath}`);
} catch (error) {
    console.error("❌ [BACKEND] ERRO CRÍTICO FFmpeg:", error.message);
}

const app = express();
// MUDANÇA CRÍTICA: Porta 3000 para não conflitar com o Frontend na 8080
const PORT = process.env.PORT || 3000; 

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

// Garante diretórios
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Middleware de Log Global
app.use((req, res, next) => {
    // Loga tudo que não for arquivo estático para debug
    if (!req.url.startsWith('/outputs')) {
        console.log(`📨 [${new Date().toLocaleTimeString()}] REQUISIÇÃO RECEBIDA: ${req.method} ${req.url}`);
    }
    next();
});

app.use(cors({ origin: '*' })); // Permite tudo para evitar bloqueio
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(OUTPUT_DIR));

// Health Check
app.get('/', (req, res) => res.status(200).send('AI Media Suite Backend Online 🟢'));
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', ffmpeg: 'ready' }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    cb(null, `upload_${Date.now()}_${Math.floor(Math.random()*1000)}_${safeName}`);
  }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 4 * 1024 * 1024 * 1024 } // 4GB limit
});

function escapeForDrawtext(text) {
    if (!text) return ' ';
    return text.replace(/\\/g, '\\\\\\\\').replace(/'/g, "'\\\\\\''").replace(/:/g, '\\\\:').replace(/\n/g, ' ');
}

// Renderiza uma cena (Imagem/Vídeo + Áudio + Texto)
const processScene = async (visualPath, audioPath, text, index, w, h, isImg) => {
    const segPath = path.join(UPLOAD_DIR, `scene_${index}_${Date.now()}.mp4`);
    console.log(`   🔨 [Cena ${index + 1}] Renderizando...`);
    
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg();

        // Inputs
        cmd.input(visualPath);
        if (isImg) cmd.inputOptions(['-loop 1', '-t 5']);

        if (audioPath && fs.existsSync(audioPath)) {
            cmd.input(audioPath);
        } else {
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi').inputOptions(['-t 5']);
        }

        // Filtros (Força tamanho e FPS padrão)
        const scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
        let vFilters = [scaleFilter, 'fps=30', 'format=yuv420p'];
        
        if (text && text.length > 0 && text !== 'undefined') {
            const sanitizedText = escapeForDrawtext(text);
            vFilters.push(`drawtext=text='${sanitizedText}':fontcolor=white:fontsize=48:box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-100`);
        }
        
        vFilters.push('fade=t=in:st=0:d=0.5'); // Fade in visual

        cmd.complexFilter([
            { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_out' },
            { filter: 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo', inputs: '1:a', outputs: 'a_out' }
        ], ['v_out', 'a_out']);

        cmd.outputOptions([
            '-c:v libx264', '-preset ultrafast', '-crf 28', 
            '-c:a aac', '-b:a 128k', 
            '-shortest', '-movflags +faststart', '-y'
        ]);

        cmd.save(segPath)
        .on('end', () => resolve(segPath))
        .on('error', (err) => {
            console.error(`   ❌ [Cena ${index + 1}] Erro FFmpeg:`, err.message);
            reject(err);
        });
    });
};

const uploadFields = upload.fields([{ name: 'visuals' }, { name: 'audios' }]);

app.post(['/ia-turbo', '/magic-workflow'], (req, res) => {
    console.log("\n📥 [UPLOAD] Recebendo arquivos do cliente...");
    
    uploadFields(req, res, async (err) => {
        if (err) {
            console.error("❌ Erro Multer:", err);
            return res.status(500).json({ error: "Falha no upload: " + err.message });
        }

        const visualFiles = req.files['visuals'] || [];
        const audioFiles = req.files['audios'] || [];
        const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
        const aspectRatio = req.body.aspectRatio || '16:9';

        console.log(`📦 [DADOS] ${visualFiles.length} visuais recebidos. Iniciando mixagem...`);

        if (visualFiles.length === 0) return res.status(400).json({ error: "Sem arquivos visuais." });

        const w = aspectRatio === '9:16' ? 720 : 1280;
        const h = aspectRatio === '9:16' ? 1280 : 720;
        const finalOutput = path.join(OUTPUT_DIR, `MASTER_${Date.now()}.mp4`);
        const segments = [];

        res.setTimeout(10 * 60 * 1000, () => console.log("⚠️ Timeout de conexão (cliente demorou a receber)."));

        try {
            // 1. Processar Cenas
            for (let i = 0; i < visualFiles.length; i++) {
                try {
                    const seg = await processScene(
                        visualFiles[i].path, 
                        audioFiles[i]?.path, 
                        narrations[i], 
                        i, w, h, 
                        visualFiles[i].mimetype.startsWith('image/')
                    );
                    segments.push(seg);
                } catch (e) {
                    console.error(`⚠️ Pulando cena ${i} com erro.`);
                }
            }

            if (segments.length === 0) throw new Error("Falha na renderização de todas as cenas.");

            // 2. Concatenar
            console.log("🔗 [CONCAT] Unindo cenas no arquivo final...");
            const listPath = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);
            const fileContent = segments.map(s => `file '${s}'`).join('\n');
            fs.writeFileSync(listPath, fileContent);

            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(listPath)
                    .inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c copy', '-y'])
                    .save(finalOutput)
                    .on('end', resolve)
                    .on('error', reject);
            });

            console.log(`✨ [SUCESSO] Vídeo pronto: ${path.basename(finalOutput)}`);
            
            // Cleanup
            try {
                fs.unlinkSync(listPath);
                segments.forEach(s => fs.unlinkSync(s));
                visualFiles.forEach(f => fs.unlinkSync(f.path));
                audioFiles.forEach(f => fs.unlinkSync(f.path));
            } catch (e) { /* ignore cleanup errors */ }

            const protocol = req.protocol;
            const host = req.get('host');
            // Retorna URL relativa ao proxy se necessário, ou absoluta
            res.json({ url: `/outputs/${path.basename(finalOutput)}` });

        } catch (error) {
            console.error("❌ ERRO FATAL:", error);
            res.status(500).json({ error: error.message });
        }
    });
});

app.post('/process-audio', upload.array('audio'), (req, res) => res.json({ url: '/outputs/demo_audio.mp3' }));
app.post('/process-image', upload.array('image'), (req, res) => res.json({ url: '/outputs/demo_image.jpg' }));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 [BACKEND] SERVIDOR RODANDO NA PORTA ${PORT}`);
    console.log(`👉 Aguardando conexões do Vite (Proxy)...`);
});
