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
console.log("\n🎥 [SERVER] INICIALIZANDO ENGINE DE VÍDEO...");
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
const DIST_DIR = path.join(__dirname, 'dist'); // Pasta do build frontend

// Garante diretórios
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(cors()); 
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// 1. Servir Arquivos Estáticos do Frontend (Build)
// Se a pasta dist existir (após npm run build), serve ela.
if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    console.log("✅ [SERVER] Servindo Frontend estático da pasta 'dist'");
} else {
    console.warn("⚠️ [SERVER] Pasta 'dist' não encontrada. Rode 'npm run build' primeiro.");
}

// 2. Servir Outputs de Vídeo
app.use('/outputs', express.static(OUTPUT_DIR));

// 3. API Health Check
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok', engine: 'ffmpeg-static' }));

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
    limits: { fileSize: 4 * 1024 * 1024 * 1024 } // 4GB limit
});

// --- FUNÇÕES FFMPEG ---

function escapeForDrawtext(text) {
    if (!text) return ' ';
    return text.replace(/\\/g, '\\\\\\\\').replace(/'/g, "'\\\\\\''").replace(/:/g, '\\\\:').replace(/\n/g, ' ');
}

const processScene = async (visualPath, audioPath, text, index, w, h, isImg, duration) => {
    const segPath = path.join(UPLOAD_DIR, `seg_${index}_${Date.now()}.mp4`);
    console.log(`   🔨 [Cena ${index + 1}] Renderizando...`);
    
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg();
        const outputDuration = duration || 5;

        // Inputs
        cmd.input(visualPath);
        if (isImg) cmd.inputOptions(['-loop 1', `-t ${outputDuration}`]);

        if (audioPath && fs.existsSync(audioPath)) {
            cmd.input(audioPath);
            // Se tiver áudio, garante que o vídeo tenha a duração do áudio ou a duração mínima
            if (!isImg) {
                // Para vídeo com áudio, não forçamos -t no input visual para não cortar, 
                // mas podemos usar o shortest no output
            }
        } else {
            // Gera silêncio se não tiver áudio
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi').inputOptions([`-t ${outputDuration}`]);
        }

        // Filtros de Vídeo
        // Scale e Crop para preencher a tela (object-fit: cover)
        const scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
        let vFilters = [scaleFilter, 'fps=30', 'format=yuv420p'];
        
        // Legendas (Drawtext)
        if (text && text.length > 0 && text !== 'undefined' && text !== 'null') {
            const sanitizedText = escapeForDrawtext(text);
            // Caixa preta semi-transparente com texto branco centralizado na parte inferior
            vFilters.push(`drawtext=text='${sanitizedText}':fontcolor=white:fontsize=42:box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-120:fontfile='Arial'`);
        }
        
        vFilters.push('fade=t=in:st=0:d=0.5'); // Fade in visual

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
        .on('end', () => resolve(segPath))
        .on('error', (err) => {
            console.error(`   ❌ [Cena ${index + 1}] Falha:`, err.message);
            reject(err);
        });
    });
};

const multiUpload = upload.fields([{ name: 'visuals' }, { name: 'audios' }]);

// --- ROTA PRINCIPAL DE RENDERIZAÇÃO ---
app.post(['/api/ia-turbo', '/api/render'], (req, res) => {
    console.log("\n📥 [RENDER] Recebendo solicitação de renderização...");
    
    multiUpload(req, res, async (err) => {
        if (err) {
            console.error("❌ Erro de Upload:", err);
            return res.status(500).json({ error: "Falha no upload: " + err.message });
        }

        const visualFiles = req.files['visuals'] || [];
        const audioFiles = req.files['audios'] || [];
        // Parsing robusto dos metadados
        let narrations = [];
        try {
            narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
        } catch(e) { narrations = []; }

        const aspectRatio = req.body.aspectRatio || '16:9';
        const resolution = req.body.resolution || '1080p';
        const durationPerImage = parseInt(req.body.durationPerImage) || 5;

        console.log(`📦 [DADOS] ${visualFiles.length} visuais, ${audioFiles.length} áudios.`);
        console.log(`⚙️ [CONFIG] ${resolution} | ${aspectRatio}`);

        if (visualFiles.length === 0) return res.status(400).json({ error: "Nenhum arquivo visual recebido." });

        // Definição de Resolução
        let w = 1280, h = 720; // Default 720p 16:9
        if (resolution === '1080p') { w = 1920; h = 1080; }
        else if (resolution === '4k') { w = 3840; h = 2160; }
        
        if (aspectRatio === '9:16') {
             // Inverte para vertical
             const temp = w; w = h; h = temp;
        } else if (aspectRatio === '1:1') {
            h = w;
        }

        const finalOutputName = `MASTER_${Date.now()}.mp4`;
        const finalOutputPath = path.join(OUTPUT_DIR, finalOutputName);
        const segments = [];

        // Timeout preventivo no Express
        res.setTimeout(15 * 60 * 1000, () => console.log("⚠️ Timeout de conexão (Express)."));

        try {
            // 1. Renderizar cada cena individualmente
            for (let i = 0; i < visualFiles.length; i++) {
                try {
                    const isImage = visualFiles[i].mimetype.startsWith('image/');
                    const sceneAudio = audioFiles[i]?.path; 
                    const sceneText = narrations[i] || "";

                    const seg = await processScene(
                        visualFiles[i].path, 
                        sceneAudio, 
                        sceneText, 
                        i, w, h, 
                        isImage,
                        durationPerImage
                    );
                    segments.push(seg);
                } catch (e) {
                    console.error(`⚠️ Pulando cena ${i} devido a erro.`);
                }
            }

            if (segments.length === 0) throw new Error("Nenhuma cena foi renderizada com sucesso.");

            // 2. Concatenar segmentos
            console.log("🔗 [CONCAT] Unindo cenas...");
            const listPath = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);
            const fileContent = segments.map(s => `file '${s}'`).join('\n');
            fs.writeFileSync(listPath, fileContent);

            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(listPath)
                    .inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c copy', '-y'])
                    .save(finalOutputPath)
                    .on('end', resolve)
                    .on('error', reject);
            });

            console.log(`✨ [CONCLUÍDO] Arquivo gerado: ${finalOutputName}`);
            
            // Limpeza de arquivos temporários
            try {
                fs.unlinkSync(listPath);
                segments.forEach(s => fs.unlinkSync(s));
                visualFiles.forEach(f => fs.unlinkSync(f.path));
                audioFiles.forEach(f => fs.unlinkSync(f.path));
            } catch (e) { /* ignore cleanup errors */ }

            // Retorna URL relativa
            res.json({ url: `/outputs/${finalOutputName}`, status: 'success' });

        } catch (error) {
            console.error("❌ ERRO NO PROCESSO:", error);
            res.status(500).json({ error: error.message });
        }
    });
});

// --- ROTA FALLBACK PARA REACT ROUTER ---
// Qualquer rota não capturada pela API ou estáticos vai para o index.html do React
app.get('*', (req, res) => {
    if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
        res.sendFile(path.join(DIST_DIR, 'index.html'));
    } else {
        res.status(404).send("Frontend não encontrado. Execute 'npm run build'.");
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 [SERVER] APLICAÇÃO RODANDO EM: http://localhost:${PORT}`);
    console.log(`   - Modo: Produção Fullstack`);
    console.log(`   - Frontend: ${fs.existsSync(DIST_DIR) ? 'Online' : 'Offline (Build necessário)'}`);
    console.log(`   - Engine: FFmpeg Ready\n`);
});
