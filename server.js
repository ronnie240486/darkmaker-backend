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
console.log("\n🎥 INICIALIZANDO ENGINE DE VÍDEO...");
try {
    // Garante que os caminhos sejam strings
    const ffmpegPath = typeof ffmpegStatic === 'string' ? ffmpegStatic : ffmpegStatic?.path;
    const ffprobePath = typeof ffprobeStatic === 'string' ? ffprobeStatic : ffprobeStatic?.path;

    if (!ffmpegPath || !ffprobePath) throw new Error("Binários do FFmpeg não encontrados.");

    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
    console.log(`✅ FFmpeg Configurado: ${ffmpegPath}`);
} catch (error) {
    console.error("❌ ERRO CRÍTICO FFmpeg:", error.message);
}

const app = express();
const PORT = process.env.PORT || 8080;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

// Garante diretórios
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Middleware de Log Global (Para ver se a requisição chega)
app.use((req, res, next) => {
    if (!req.url.includes('/outputs')) {
        console.log(`📨 [${new Date().toLocaleTimeString()}] RECEBENDO REQUISIÇÃO: ${req.method} ${req.url}`);
    }
    next();
});

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(OUTPUT_DIR));

// Rota de teste de saúde
app.get('/', (req, res) => res.send('AI Media Suite Backend Online 🟢'));

// Configuração de Upload (Multer) - Aumentado limites
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Sanitiza nome do arquivo
    const safeName = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    cb(null, `upload_${Date.now()}_${safeName}`);
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

/**
 * PROCESSA UMA ÚNICA CENA
 */
const processScene = async (visualPath, audioPath, text, index, w, h, isImg) => {
    const segPath = path.join(UPLOAD_DIR, `render_scene_${index}_${Date.now()}.mp4`);
    console.log(`   👉 Processando Cena ${index + 1}...`);
    
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg();

        // Input Visual
        cmd.input(visualPath);
        if (isImg) cmd.inputOptions(['-loop 1', '-t 5']); // Imagem estática: 5s duração

        // Input Áudio (ou silêncio se não houver)
        if (audioPath && fs.existsSync(audioPath)) {
            cmd.input(audioPath);
        } else {
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi').inputOptions(['-t 5']);
        }

        // Filtros (Simplificados para performance)
        const scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
        let vFilters = [scaleFilter];
        
        // Legenda simples
        if (text && text.length > 0 && text !== 'undefined') {
            const sanitizedText = escapeForDrawtext(text);
            // Box preta semi-transparente no fundo
            vFilters.push(`drawtext=text='${sanitizedText}':fontcolor=white:fontsize=42:box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-(text_h)-50`);
        }

        // Fade básico
        vFilters.push('fade=t=in:st=0:d=0.5');

        // Mapeamento explícito
        cmd.complexFilter([
            { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_out' },
            { filter: 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo', inputs: '1:a', outputs: 'a_out' }
        ], ['v_out', 'a_out']);

        cmd.outputOptions([
            '-c:v libx264', 
            '-preset superfast', // Muito rápido
            '-crf 28', // Qualidade média/boa (menor arquivo)
            '-c:a aac',
            '-b:a 128k',
            '-pix_fmt yuv420p',
            '-shortest', // Corta vídeo pelo tamanho do áudio
            '-movflags +faststart'
        ]);

        cmd.save(segPath)
        .on('end', () => {
            console.log(`   ✅ Cena ${index + 1} OK.`);
            resolve(segPath);
        })
        .on('error', (err) => {
            console.error(`   ❌ Falha Cena ${index + 1}:`, err.message);
            reject(err);
        });
    });
};

/**
 * ROTA PRINCIPAL: UPLOAD + RENDER
 */
const uploadFields = upload.fields([{ name: 'visuals' }, { name: 'audios' }]);

app.post(['/ia-turbo', '/magic-workflow'], (req, res) => {
    console.log("📥 Iniciando Upload de Arquivos...");
    
    uploadFields(req, res, async (err) => {
        if (err) {
            console.error("❌ Erro no Upload (Multer):", err);
            return res.status(500).json({ error: "Erro no upload: " + err.message });
        }

        console.log("📦 Upload Finalizado. Iniciando Lógica de Renderização...");

        // Dados do Request
        const visualFiles = req.files['visuals'] || [];
        const audioFiles = req.files['audios'] || [];
        // Parsing seguro do JSON de narrações
        let narrations = [];
        try {
            narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
        } catch (e) {
            console.warn("⚠️ Aviso: Falha ao parsear narrações JSON");
        }
        
        const aspectRatio = req.body.aspectRatio || '16:9';

        if (visualFiles.length === 0) {
            return res.status(400).json({ error: "Nenhum arquivo visual recebido." });
        }

        // Configura resolução
        const w = aspectRatio === '9:16' ? 720 : 1280;
        const h = aspectRatio === '9:16' ? 1280 : 720;
        
        const finalOutput = path.join(OUTPUT_DIR, `MASTER_${Date.now()}.mp4`);
        const segments = [];

        // Timeout manual de 15 minutos
        res.setTimeout(900000, () => {
            console.error("❌ Timeout de 15min atingido.");
        });

        try {
            console.log(`🎬 Renderizando ${visualFiles.length} cenas em ${w}x${h}...`);

            // Loop Síncrono (Processa um por um para não matar a CPU)
            for (let i = 0; i < visualFiles.length; i++) {
                const visFile = visualFiles[i];
                const audFile = audioFiles[i] || null; // Pode não ter áudio
                const text = narrations[i] || "";
                const isImage = visFile.mimetype.startsWith('image/');

                try {
                    const segmentPath = await processScene(visFile.path, audFile?.path, text, i, w, h, isImage);
                    segments.push(segmentPath);
                } catch (sceneErr) {
                    console.error(`⚠️ Pulando cena ${i} devido a erro de renderização.`);
                }
            }

            if (segments.length === 0) throw new Error("Falha fatal: Nenhuma cena foi gerada com sucesso.");

            // Concatenação Final
            console.log("🔗 Juntando cenas (Concat)...");
            const listPath = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);
            const fileContent = segments.map(s => `file '${s}'`).join('\n');
            fs.writeFileSync(listPath, fileContent);

            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(listPath)
                    .inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c copy']) // Copy é instantâneo
                    .save(finalOutput)
                    .on('end', resolve)
                    .on('error', reject);
            });

            console.log("✨ VÍDEO PRONTO! Enviando URL...");
            
            // Limpeza de arquivos temporários
            segments.forEach(s => { if(fs.existsSync(s)) fs.unlinkSync(s); });
            if(fs.existsSync(listPath)) fs.unlinkSync(listPath);
            visualFiles.forEach(f => { if(fs.existsSync(f.path)) fs.unlinkSync(f.path); });
            audioFiles.forEach(f => { if(fs.existsSync(f.path)) fs.unlinkSync(f.path); });

            const protocol = req.protocol;
            const host = req.get('host');
            res.json({ url: `${protocol}://${host}/outputs/${path.basename(finalOutput)}` });

        } catch (error) {
            console.error("❌ ERRO NO PROCESSO:", error);
            res.status(500).json({ error: error.message });
        }
    });
});

app.post('/process-audio', upload.array('audio'), (req, res) => {
    // Mock para evitar erros nas ferramentas de áudio por enquanto
    console.log("🎵 Processando áudio (Mock)...");
    res.json({ url: 'http://localhost:8080/outputs/demo_audio.mp3' });
});

app.post('/process-image', upload.array('image'), (req, res) => {
    console.log("🖼️ Processando imagem (Mock)...");
    res.json({ url: 'http://localhost:8080/outputs/demo_image.jpg' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 SERVIDOR ONLINE NA PORTA ${PORT}`);
    console.log(`📁 Uploads: ${UPLOAD_DIR}`);
    console.log(`📁 Outputs: ${OUTPUT_DIR}`);
});
