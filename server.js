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
    console.log(`✅ MASTER ENGINE v5.5 (STATIC) - STABILITY PATCH`);
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

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(OUTPUT_DIR));

// Configuração de Upload (Multer)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    cb(null, `media_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`);
  }
});

// Aumentado para 500MB para suportar vídeos HD/4K
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 500 * 1024 * 1024 } 
});

// Utilitário para escapar texto no FFmpeg drawtext
function escapeForDrawtext(text) {
    if (!text) return ' ';
    return text.replace(/\\/g, '\\\\\\\\').replace(/'/g, "'\\\\\\''").replace(/:/g, '\\\\:');
}

/**
 * MOTOR DE PROCESSAMENTO DE CENA (VÍDEO + ÁUDIO)
 */
const processScene = async (visual, audio, text, index, w, h, isImg, UPLOAD_DIR) => {
    const segPath = path.join(UPLOAD_DIR, `seg_${index}_${Date.now()}.mp4`);
    
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg();

        // Input 0: Visual (Força loop se for imagem)
        if (isImg) {
            cmd.input(visual.path).inputOptions(['-loop 1', '-t 10']); // Duração padrão 10s
        } else {
            cmd.input(visual.path); 
        }

        // Input 1: Áudio (ou silêncio gerado)
        if (audio && fs.existsSync(audio.path)) {
            cmd.input(audio.path);
        } else {
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi').inputOptions(['-t 10']);
        }

        // --- FILTROS DE VÍDEO COMPLEXOS ---
        let vFilters = [
            `scale=${w}:${h}:force_original_aspect_ratio=increase`,
            `crop=${w}:${h}`,
            `setsar=1/1`
        ];

        // Efeito Ken Burns (Zoom Lento) apenas para imagens
        if (isImg) {
            vFilters.push(`zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:d=300`);
        }

        // Legendas (Drawtext) - Queimadas no vídeo
        if (text && text.trim().length > 0) {
            const sanitizedText = escapeForDrawtext(text);
            vFilters.push(
                `drawtext=text='${sanitizedText}':fontcolor=white:fontsize=(h/20):box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-(text_h*2)`
            );
        }

        // Fade In/Out na cena
        vFilters.push(`fade=t=in:st=0:d=0.5`, `fade=t=out:st=9.5:d=0.5`);
        vFilters.push('format=yuv420p', 'fps=30');

        // --- FILTROS DE ÁUDIO ---
        let aFilters = [
            'aresample=44100',
            'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
            'volume=1.5',
            'afade=t=in:st=0:d=0.3',
            'afade=t=out:st=9.7:d=0.3'
        ];

        cmd.complexFilter([
            { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_processed' },
            { filter: aFilters.join(','), inputs: '1:a', outputs: 'a_processed' }
        ]);

        cmd.map('v_processed').map('a_processed');
        
        cmd.outputOptions([
            '-c:v libx264',
            '-preset ultrafast',
            '-c:a aac',
            '-b:a 192k',
            '-pix_fmt yuv420p',
            '-t 10',
            '-movflags +faststart'
        ])
        .save(segPath)
        .on('end', () => resolve(segPath))
        .on('error', (err) => {
            console.error(`❌ Erro cena ${index}:`, err.message);
            reject(err);
        });
    });
};

/**
 * ROTAS DE VÍDEO
 */
app.post(['/ia-turbo', '/magic-workflow'], upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'] || [];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
    const aspectRatio = req.body.aspectRatio || '16:9';

    if (visualFiles.length === 0) return res.status(400).send('Sem mídia visual para processar.');

    const isVertical = aspectRatio === '9:16';
    const w = isVertical ? 1080 : 1920;
    const h = isVertical ? 1920 : 1080;

    const finalOutput = path.join(OUTPUT_DIR, `master_${Date.now()}.mp4`);
    const segments = [];

    const timeout = setTimeout(() => {
         if (!res.headersSent) res.status(504).send("Timeout: O vídeo é muito complexo para este servidor demo.");
    }, 300000);

    try {
        console.log(`🎬 Iniciando Renderização Master: ${visualFiles.length} cenas em ${w}x${h}...`);
        
        for (let i = 0; i < visualFiles.length; i++) {
            try {
                const seg = await processScene(
                    visualFiles[i], 
                    audioFiles[i] || null, 
                    narrations[i] || '', 
                    i, w, h, 
                    visualFiles[i].mimetype.startsWith('image/'), 
                    UPLOAD_DIR
                );
                segments.push(seg);
            } catch (err) {
                console.error(`Pular cena ${i} devido a erro crítico:`, err.message);
            }
        }

        if (segments.length === 0) throw new Error("Falha completa: Nenhuma cena foi renderizada com sucesso.");

        const concatCmd = ffmpeg();
        const listPath = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);
        const fileContent = segments.map(s => `file '${s}'`).join('\n');
        fs.writeFileSync(listPath, fileContent);

        concatCmd
            .input(listPath)
            .inputOptions(['-f concat', '-safe 0'])
            .outputOptions([
                '-c copy',
                '-movflags +faststart'
            ])
            .save(finalOutput)
            .on('end', () => {
                clearTimeout(timeout);
                console.log(`✅ Master Finalizada: ${finalOutput}`);
                
                segments.forEach(s => fs.unlink(s, () => {}));
                if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
                
                const protocol = req.protocol;
                const host = req.get('host');
                const fullUrl = `${protocol}://${host}/outputs/${path.basename(finalOutput)}`;
                
                res.json({ url: fullUrl });
            })
            .on('error', (err) => {
                clearTimeout(timeout);
                console.error("❌ Erro Concatenação Final:", err.message);
                res.status(500).send("Erro na montagem final do vídeo: " + err.message);
            });

    } catch (e) {
        clearTimeout(timeout);
        console.error("❌ Falha Geral:", e.message);
        res.status(500).send(e.message);
    }
});

app.post('/process-audio', upload.array('audio'), (req, res) => {
    res.json({ url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' });
});

app.post('/process-image', upload.array('image'), (req, res) => {
    res.json({ url: 'https://via.placeholder.com/1080' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 MASTER ENGINE v5.5 ONLINE NA PORTA ${PORT}`));
