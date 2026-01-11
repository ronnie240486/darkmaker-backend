
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURAÇÃO DO FFMPEG ---
let ffmpegPath, ffprobePath;
try {
    // Attempt to import paths. Note: Some installers might need special handling in ESM
    // If these fail, you might need to install @ffmpeg-installer/ffmpeg and @ffprobe-installer/ffprobe
    // and manually set the path if they don't export properly for ESM.
    const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg');
    const ffprobeInstaller = await import('@ffprobe-installer/ffprobe');
    
    ffmpegPath = ffmpegInstaller.default?.path || ffmpegInstaller.path;
    ffprobePath = ffprobeInstaller.default?.path || ffprobeInstaller.path;
    
    if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
    if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);
    
    console.log(`✅ MASTER ENGINE v5.3 (ESM) - AUDIO SYNC & MULTI-ROUTING`);
} catch (error) {
    console.warn("⚠️ Aviso FFmpeg: Verifique se os instaladores estão disponíveis. Erro:", error.message);
}

const app = express();
const PORT = process.env.PORT || 8080;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(OUTPUT_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    cb(null, `media_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`);
  }
});
const upload = multer({ storage: storage });

function escapeForDrawtext(text) {
    if (!text) return ' ';
    return text
        .replace(/\\/g, '\\\\\\\\')
        .replace(/'/g, "'\\\\\\''")
        .replace(/:/g, '\\\\:')
        .replace(/,/g, '\\\\,')
        .replace(/%/g, '\\\\%')
        .replace(/\[/g, '\\\\[')
        .replace(/\]/g, '\\\\]');
}

/**
 * MOTOR DE PROCESSAMENTO DE CENA (VÍDEO + ÁUDIO)
 */
const processScene = async (visual, audio, text, index, w, h, isImg, UPLOAD_DIR) => {
    const segPath = path.join(UPLOAD_DIR, `seg_${index}_${Date.now()}.mp4`);
    
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg();

        // Input 0: Visual
        if (isImg) cmd.input(visual.path).inputOptions(['-loop 1']);
        else cmd.input(visual.path);

        // Input 1: Áudio (Narração ou Silêncio Gerado)
        if (audio && fs.existsSync(audio.path)) {
            cmd.input(audio.path);
        } else {
            // CRITICAL: Gera um rastro de áudio vazio se não houver narração
            // Isso evita erro de concatenação posterior (vídeo sem áudio + vídeo com áudio)
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi');
        }

        let vFilters = [
            `scale=${w}:${h}:force_original_aspect_ratio=increase`,
            `crop=${w}:${h}`,
            `setsar=1/1`
        ];

        if (isImg) {
            vFilters.push(`zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:d=150`);
        }

        if (text) {
            const cleanText = escapeForDrawtext(text);
            const fSize = Math.floor(h * 0.04);
            vFilters.push(`drawtext=text='${cleanText}':fontcolor=white:fontsize=${fSize}:box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-(h*0.2):line_spacing=15`);
        }

        vFilters.push(`fade=t=in:st=0:d=0.5`, `fade=t=out:st=4.5:d=0.5`);
        vFilters.push('format=yuv420p', 'fps=30');

        let aFilters = [
            'aresample=44100',
            'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
            'volume=1.5',
            'afade=t=in:st=0:d=0.3',
            'afade=t=out:st=4.7:d=0.3'
        ];

        cmd.complexFilter([
            { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_processed' },
            { filter: aFilters.join(','), inputs: '1:a', outputs: 'a_processed' }
        ]);

        cmd.map('v_processed').map('a_processed');
        cmd.duration(5); // Padroniza todas as cenas em 5 segundos

        cmd.outputOptions([
            '-c:v libx264',
            '-preset ultrafast',
            '-c:a aac',
            '-b:a 192k',
            '-shortest'
        ])
        .save(segPath)
        .on('end', () => resolve(segPath))
        .on('error', (err) => {
            console.error(`Erro na cena ${index}:`, err);
            reject(err);
        });
    });
};

/**
 * ROTA: PROCESSAMENTO DE ÁUDIO (JOIN / CLEAN / STEMS)
 */
app.post('/process-audio', upload.array('audio'), async (req, res) => {
    const files = req.files || [];
    const action = req.body.action || 'join';

    if (files.length === 0) return res.status(400).send('Nenhum arquivo de áudio enviado.');

    const outputPath = path.join(OUTPUT_DIR, `audio_${Date.now()}.mp3`);
    
    try {
        let cmd = ffmpeg();
        files.forEach(f => cmd.input(f.path));

        if (files.length > 1) {
            cmd.mergeToFile(outputPath, UPLOAD_DIR)
                .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(outputPath)}` }))
                .on('error', (err) => res.status(500).send(err.message));
        } else {
            // Processamento Simples (Volume / Bass / Clean)
            cmd.audioFilters(['volume=1.2', 'highpass=f=200', 'lowpass=f=3000'])
                .save(outputPath)
                .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(outputPath)}` }))
                .on('error', (err) => res.status(500).send(err.message));
        }
    } catch (e) {
        res.status(500).send(e.message);
    }
});

/**
 * ROTA: PROCESSAMENTO DE IMAGEM
 */
app.post('/process-image', upload.array('image'), async (req, res) => {
    const files = req.files || [];
    if (files.length === 0) return res.status(400).send('Nenhuma imagem enviada.');
    
    // Simplesmente retorna a primeira imagem por enquanto (placeholder para IA de imagem)
    res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(files[0].path)}` });
});

/**
 * ROTAS DE VÍDEO (TURBO E MAGIC)
 */
app.post(['/ia-turbo', '/magic-workflow'], upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'] || [];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
    const aspectRatio = req.body.aspectRatio || '16:9';

    if (visualFiles.length === 0) return res.status(400).send('Sem mídia para processar.');

    const isVertical = aspectRatio === '9:16';
    const w = isVertical ? 1080 : 1920;
    const h = isVertical ? 1920 : 1080;

    const finalOutput = path.join(OUTPUT_DIR, `master_${Date.now()}.mp4`);
    const segments = [];

    try {
        console.log(`🎬 Masterizando ${visualFiles.length} cenas...`);
        for (let i = 0; i < visualFiles.length; i++) {
            const seg = await processScene(
                visualFiles[i], 
                audioFiles[i] || null, 
                narrations[i] || null, 
                i, w, h, 
                visualFiles[i].mimetype.startsWith('image/'), 
                UPLOAD_DIR
            );
            segments.push(seg);
        }

        // CONCATENAÇÃO FINAL
        const concatCmd = ffmpeg();
        segments.forEach(s => concatCmd.input(s));

        const filterStr = segments.map((_, idx) => `[${idx}:v][${idx}:a]`).join('') + `concat=n=${segments.length}:v=1:a=1[v][a]`;
        
        concatCmd.complexFilter(filterStr)
            .map('[v]').map('[a]')
            .outputOptions([
                '-c:v libx264',
                '-preset medium',
                '-crf 22',
                '-c:a aac',
                '-b:a 192k',
                '-movflags +faststart'
            ])
            .save(finalOutput)
            .on('end', () => {
                console.log(`✅ Vídeo Gerado: ${finalOutput}`);
                segments.forEach(s => fs.unlink(s, () => {}));
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(finalOutput)}` });
            })
            .on('error', (err) => {
                console.error("Erro Final:", err);
                res.status(500).send(err.message);
            });

    } catch (e) {
        console.error("Falha no Motor:", e);
        res.status(500).send(e.message);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 MASTER ENGINE v5.3 (ESM) ONLINE NA PORTA ${PORT}`));
