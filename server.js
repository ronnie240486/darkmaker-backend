
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
    return text.replace(/\\/g, '\\\\\\\\').replace(/'/g, "'\\\\\\''").replace(/:/g, '\\\\:');
}

/**
 * MOTOR DE PROCESSAMENTO DE CENA (VÍDEO + ÁUDIO)
 */
const processScene = async (visual, audio, text, index, w, h, isImg, UPLOAD_DIR) => {
    const segPath = path.join(UPLOAD_DIR, `seg_${index}_${Date.now()}.mp4`);
    
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg();

        // Input 0: Visual (Force 5s duration to prevent infinite loops)
        if (isImg) {
            cmd.input(visual.path).inputOptions(['-loop 1', '-t 5']);
        } else {
            cmd.input(visual.path).inputOptions(['-t 5']);
        }

        // Input 1: Áudio
        if (audio && fs.existsSync(audio.path)) {
            cmd.input(audio.path).inputOptions(['-t 5']);
        } else {
            // Generate silence if no audio, critical for concat
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi').inputOptions(['-t 5']);
        }

        let vFilters = [
            `scale=${w}:${h}:force_original_aspect_ratio=increase`,
            `crop=${w}:${h}`,
            `setsar=1/1`
        ];

        if (isImg) {
            vFilters.push(`zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:d=150`);
        }

        // Removed drawtext to prevent font errors causing hangs
        
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
        
        // Output options
        cmd.outputOptions([
            '-c:v libx264',
            '-preset ultrafast',
            '-c:a aac',
            '-b:a 192k',
            '-pix_fmt yuv420p',
            '-t 5', // Hard limit duration
            '-movflags +faststart'
        ])
        .save(segPath)
        .on('end', () => resolve(segPath))
        .on('error', (err) => {
            console.error(`❌ Erro cena ${index}:`, err.message);
            // In case of error, resolve with null or handle gracefully? 
            // Better to reject and let the main loop handle it, but reject fast.
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

    if (visualFiles.length === 0) return res.status(400).send('Sem mídia.');

    const isVertical = aspectRatio === '9:16';
    const w = isVertical ? 1080 : 1920;
    const h = isVertical ? 1920 : 1080;

    const finalOutput = path.join(OUTPUT_DIR, `master_${Date.now()}.mp4`);
    const segments = [];

    // Timeout de segurança global (2 minutos)
    const timeout = setTimeout(() => {
         if (!res.headersSent) res.status(504).send("Timeout no servidor de renderização.");
    }, 120000);

    try {
        console.log(`🎬 Iniciando Render: ${visualFiles.length} cenas...`);
        
        // Process scenes sequentially to avoid memory spike
        for (let i = 0; i < visualFiles.length; i++) {
            try {
                const seg = await processScene(
                    visualFiles[i], 
                    audioFiles[i] || null, 
                    narrations[i] || null, 
                    i, w, h, 
                    visualFiles[i].mimetype.startsWith('image/'), 
                    UPLOAD_DIR
                );
                segments.push(seg);
            } catch (err) {
                console.error(`Pular cena ${i} devido a erro:`, err.message);
                // Continue if one scene fails
            }
        }

        if (segments.length === 0) throw new Error("Falha ao processar todas as cenas.");

        // Concatenação
        const concatCmd = ffmpeg();
        segments.forEach(s => concatCmd.input(s));

        const filterStr = segments.map((_, idx) => `[${idx}:v][${idx}:a]`).join('') + `concat=n=${segments.length}:v=1:a=1[v][a]`;
        
        concatCmd.complexFilter(filterStr)
            .map('[v]').map('[a]')
            .outputOptions([
                '-c:v libx264',
                '-preset ultrafast', // Faster preset
                '-crf 25', // Lower quality for speed
                '-c:a aac',
                '-movflags +faststart'
            ])
            .save(finalOutput)
            .on('end', () => {
                clearTimeout(timeout);
                console.log(`✅ Concluído: ${finalOutput}`);
                segments.forEach(s => fs.unlink(s, () => {})); // Cleanup
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(finalOutput)}` });
            })
            .on('error', (err) => {
                clearTimeout(timeout);
                console.error("❌ Erro Concat:", err.message);
                res.status(500).send(err.message);
            });

    } catch (e) {
        clearTimeout(timeout);
        console.error("❌ Falha Geral:", e.message);
        res.status(500).send(e.message);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 MASTER ENGINE v5.5 ONLINE NA PORTA ${PORT}`));
