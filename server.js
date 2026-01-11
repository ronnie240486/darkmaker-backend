
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

// --- CONFIGURAÇÃO DO FFMPEG ---
let ffmpegPath, ffprobePath;
try {
    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    ffprobePath = require('@ffprobe-installer/ffprobe').path;
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
    process.env.FFMPEG_PATH = ffmpegPath;
    process.env.FFPROBE_PATH = ffprobePath;
    console.log(`✅ MOTOR TURBO PRO v3.5 - ONLINE`);
} catch (error) {
    console.error("❌ Erro FFmpeg:", error);
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
    cb(null, `turbo_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`);
  }
});
const upload = multer({ storage: storage });

/**
 * Escapa textos para o filtro drawtext com máxima compatibilidade.
 */
function escapeFFmpegText(text) {
    if (!text) return ' ';
    return text
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "'\\''")
        .replace(/:/g, '\\:')
        .replace(/,/g, '\\,')
        .replace(/%/g, '\\%')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]');
}

/**
 * IA TURBO - RENDERIZAÇÃO MESTRE COM ÁUDIO E LEGENDA
 */
app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];

    if (!visualFiles || visualFiles.length === 0) return res.status(400).send('Sem arquivos visuais.');

    const resParam = req.body.resolution || '1080p';
    const isVertical = req.body.aspectRatio === '9:16';
    
    let w = isVertical ? 1080 : (resParam === '4K' ? 3840 : 1920);
    let h = isVertical ? 1920 : (resParam === '4K' ? 2160 : 1080);
    
    // Dimensões estritamente pares
    w = Math.floor(w / 2) * 2;
    h = Math.floor(h / 2) * 2;

    const outputName = `master_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputName);

    try {
        const segments = [];

        for (let i = 0; i < visualFiles.length; i++) {
            const visual = visualFiles[i];
            const audio = audioFiles[i] || null;
            const text = narrations[i] || '';
            const isImg = visual.mimetype.startsWith('image/');
            const segPath = path.join(UPLOAD_DIR, `seg_${i}_${Date.now()}.mp4`);

            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();

                // Input 0: Visual
                if (isImg) {
                    cmd.input(visual.path).inputOptions(['-loop 1']);
                } else {
                    cmd.input(visual.path);
                }

                // Input 1: Áudio (SEMPRE GARANTE UM FLUXO DE ÁUDIO)
                if (audio) {
                    cmd.input(audio.path);
                } else {
                    // Silêncio gerado via lavfi como input
                    cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi');
                }

                // Filtros de Vídeo
                let vFilters = [
                    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
                    `crop=${w}:${h}`,
                    `setsar=1/1`
                ];

                if (isImg) {
                    vFilters.push(`zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:d=1:fps=30`);
                }

                // Burn-in das Legendas (Legends)
                if (text && text.trim() !== '') {
                    const cleanText = escapeFFmpegText(text);
                    const fontSize = Math.floor(h * 0.045);
                    vFilters.push(`drawtext=text='${cleanText}':fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.5:boxborderw=10:x=(w-text_w)/2:y=h-th-(h*0.1)`);
                }

                vFilters.push('format=yuv420p', 'fps=30');

                // Filtros de Áudio (Normalização)
                const aFilters = [
                    'aresample=44100',
                    'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
                    'volume=1.2'
                ];

                cmd.complexFilter([
                    { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_out' },
                    // Usamos '1' sem ':a' para aceitar tanto arquivos quanto lavfi silêncio
                    { filter: aFilters.join(','), inputs: '1', outputs: 'a_out' }
                ]);

                cmd.map('v_out').map('a_out');

                if (isImg) cmd.duration(5);

                cmd.outputOptions([
                    '-c:v libx264',
                    '-preset ultrafast', // Velocidade máxima por segmento
                    '-crf 22',
                    '-c:a aac',
                    '-shortest'
                ])
                .save(segPath)
                .on('end', () => { segments.push(segPath); resolve(); })
                .on('error', (err) => { console.error(`Erro Seg ${i}:`, err.message); reject(err); });
            });
        }

        // CONCATENAÇÃO FINAL
        if (segments.length === 0) throw new Error("Falha ao gerar segmentos.");

        const finalCmd = ffmpeg();
        segments.forEach(s => finalCmd.input(s));
        
        const inputs = segments.map((_, idx) => `[${idx}:v][${idx}:a]`).join('');
        const concatFilter = `${inputs}concat=n=${segments.length}:v=1:a=1[v][a]`;

        finalCmd.complexFilter(concatFilter)
            .map('[v]').map('[a]')
            .outputOptions([
                '-c:v libx264',
                '-preset medium',
                '-crf 20',
                '-c:a aac',
                '-movflags +faststart'
            ])
            .save(outputPath)
            .on('end', () => {
                segments.forEach(s => fs.unlink(s, () => {}));
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputName}` });
            })
            .on('error', (err) => {
                console.error("Erro Concat:", err.message);
                res.status(500).send(`Erro na Finalização: ${err.message}`);
            });

    } catch (error) {
        console.error("Erro Fatal Turbo:", error.message);
        res.status(500).send(`Erro de Renderização: ${error.message}`);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 SERVIDOR TURBO v3.5 - PORTA ${PORT}`));
