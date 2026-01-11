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
try {
    ffmpeg.setFfmpegPath(ffmpegStatic);
    ffmpeg.setFfprobePath(ffprobeStatic.path);
    console.log(`✅ ENGINE VIDEO (FFMPEG) INICIADA COM SUCESSO`);
} catch (error) {
    console.warn("⚠️ Aviso FFmpeg:", error.message);
}

const app = express();
const PORT = process.env.PORT || 8080;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

// Garante diretórios
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(OUTPUT_DIR));

// Configuração de Upload (Multer)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    cb(null, `media_${Date.now()}_${Math.round(Math.random() * 1000)}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`);
  }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 2048 * 1024 * 1024 } // 2GB limit
});

function escapeForDrawtext(text) {
    if (!text) return ' ';
    return text.replace(/\\/g, '\\\\\\\\').replace(/'/g, "'\\\\\\''").replace(/:/g, '\\\\:');
}

/**
 * PROCESSA UMA ÚNICA CENA
 */
const processScene = async (visual, audio, text, index, w, h, isImg, UPLOAD_DIR) => {
    const segPath = path.join(UPLOAD_DIR, `scene_${index}_render.mp4`);
    console.log(`   🔨 [Cena ${index + 1}] Iniciando processamento...`);
    
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg();

        // --- INPUTS ---
        if (isImg) {
            // Input 0: Imagem em loop
            cmd.input(visual.path).inputOptions(['-loop 1', '-t 5']); // 5 segundos por imagem estática
        } else {
            // Input 0: Vídeo
            cmd.input(visual.path);
        }

        // Input 1: Áudio (ou silêncio)
        if (audio && fs.existsSync(audio.path)) {
            cmd.input(audio.path);
        } else {
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi').inputOptions(['-t 5']);
        }

        // --- FILTROS ---
        // Força escala e proporção para evitar erro de concatenação
        const scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
        
        let vFilters = [scaleFilter];
        
        // Texto na tela
        if (text && text.length > 0) {
            const sanitizedText = escapeForDrawtext(text);
            vFilters.push(`drawtext=text='${sanitizedText}':fontcolor=white:fontsize=48:box=1:boxcolor=black@0.5:x=(w-text_w)/2:y=h-100`);
        }

        // Fade In/Out para transição suave
        vFilters.push('fade=t=in:st=0:d=0.5');
        // Nota: fade out precisa saber a duração, vamos simplificar apenas com fade in por segurança

        // Áudio filters
        const aFilters = ['aresample=44100', 'aformat=sample_fmts=fltp:channel_layouts=stereo'];

        cmd.complexFilter([
            { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_out' },
            { filter: aFilters.join(','), inputs: '1:a', outputs: 'a_out' }
        ], 'v_out'); // Map output directly

        // Opções de saída para garantir compatibilidade máxima
        cmd.outputOptions([
            '-map [v_out]', 
            '-map [a_out]',
            '-c:v libx264', 
            '-preset ultrafast', // Prioriza velocidade
            '-pix_fmt yuv420p',
            '-shortest', // Corta pelo menor input (geralmente o áudio define a duração da cena)
            '-movflags +faststart'
        ]);

        cmd.save(segPath)
        .on('end', () => {
            console.log(`   ✅ [Cena ${index + 1}] Renderizada.`);
            resolve(segPath);
        })
        .on('error', (err) => {
            console.error(`   ❌ [Cena ${index + 1}] FALHOU:`, err.message);
            reject(err);
        });
    });
};

/**
 * ROTA MESTRA
 */
const uploadFields = upload.fields([{ name: 'visuals' }, { name: 'audios' }]);

app.post(['/ia-turbo', '/magic-workflow'], (req, res) => {
    console.log("\n🚀 RECEBENDO NOVA REQUISIÇÃO DE VÍDEO...");
    
    uploadFields(req, res, async (err) => {
        if (err) {
            console.error("❌ Erro no Upload:", err);
            return res.status(500).send("Erro no upload de arquivos.");
        }

        console.log("📦 Upload Concluído. Arquivos salvos no disco.");

        const visualFiles = req.files['visuals'] || [];
        const audioFiles = req.files['audios'] || [];
        const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
        const aspectRatio = req.body.aspectRatio || '16:9';

        console.log(`📊 DADOS: ${visualFiles.length} visuais, ${audioFiles.length} áudios.`);

        if (visualFiles.length === 0) return res.status(400).send('Sem arquivos visuais.');

        // Dimensões alvo
        const w = aspectRatio === '9:16' ? 720 : 1280; // 720p para ser mais rápido
        const h = aspectRatio === '9:16' ? 1280 : 720;

        const segments = [];
        const finalOutput = path.join(OUTPUT_DIR, `MASTER_${Date.now()}.mp4`);

        try {
            // 1. Renderizar cada cena individualmente
            console.log("🎬 INICIANDO RENDERIZAÇÃO DAS CENAS...");
            
            for (let i = 0; i < visualFiles.length; i++) {
                try {
                    const isImage = visualFiles[i].mimetype.startsWith('image/');
                    const seg = await processScene(visualFiles[i], audioFiles[i], narrations[i], i, w, h, isImage, UPLOAD_DIR);
                    segments.push(seg);
                } catch (e) {
                    console.error(`Pulei a cena ${i} devido a erro.`);
                }
            }

            if (segments.length === 0) throw new Error("Nenhuma cena foi renderizada com sucesso.");

            // 2. Juntar tudo (Concat)
            console.log("🔗 JUNTANDO CENAS (CONCAT)...");
            const listPath = path.join(UPLOAD_DIR, `concat_list_${Date.now()}.txt`);
            const listContent = segments.map(s => `file '${s}'`).join('\n');
            fs.writeFileSync(listPath, listContent);

            ffmpeg()
                .input(listPath)
                .inputOptions(['-f concat', '-safe 0'])
                .outputOptions(['-c copy', '-movflags +faststart']) // Copy é muito mais rápido para juntar
                .save(finalOutput)
                .on('end', () => {
                    console.log("✨ VÍDEO FINALIZADO COM SUCESSO!");
                    console.log(`👉 Arquivo: ${finalOutput}`);
                    
                    // Limpar temporários
                    segments.forEach(s => fs.unlink(s, () => {}));
                    fs.unlink(listPath, () => {});
                    
                    const protocol = req.protocol;
                    const host = req.get('host');
                    res.json({ url: `${protocol}://${host}/outputs/${path.basename(finalOutput)}` });
                })
                .on('error', (err) => {
                    console.error("❌ Erro na Junção Final:", err.message);
                    res.status(500).send("Erro ao juntar vídeos.");
                });

        } catch (error) {
            console.error("❌ ERRO FATAL NO PROCESSO:", error);
            res.status(500).send(error.message);
        }
    });
});

app.post('/process-audio', upload.array('audio'), (req, res) => res.json({ url: 'http://localhost:8080/outputs/demo.mp3' })); // Dummy fix
app.post('/process-image', upload.array('image'), (req, res) => res.json({ url: 'http://localhost:8080/outputs/demo.jpg' })); // Dummy fix

app.listen(PORT, '0.0.0.0', () => console.log(`🔥 SERVER ON PORT ${PORT} - AGUARDANDO REQUISIÇÕES`));
