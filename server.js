
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
    console.log(`✅ MOTOR TURBO ULTRA v3.6 - AUDIO SYNC OK`);
} catch (error) {
    console.error("❌ Erro Crítico FFmpeg:", error);
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
    cb(null, `master_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`);
  }
});
const upload = multer({ storage: storage });

/**
 * Escapamento de texto para drawtext (Legendas).
 * Essencial para evitar que vírgulas ou aspas quebrem a linha de comando do FFmpeg.
 */
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
 * RENDERIZADOR TURBO v3.6 - MASTER AUDIO SYNC
 */
app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];

    if (!visualFiles || visualFiles.length === 0) return res.status(400).send('Erro: Nenhum visual enviado.');

    const resParam = req.body.resolution || '1080p';
    const isVertical = req.body.aspectRatio === '9:16';
    
    let w = isVertical ? 1080 : (resParam === '4K' ? 3840 : 1920);
    let h = isVertical ? 1920 : (resParam === '4K' ? 2160 : 1080);
    
    // Dimensões pares obrigatórias
    w = Math.floor(w / 2) * 2;
    h = Math.floor(h / 2) * 2;

    const finalOutputName = `render_final_${Date.now()}.mp4`;
    const finalOutputPath = path.join(OUTPUT_DIR, finalOutputName);

    try {
        const segmentPaths = [];

        for (let i = 0; i < visualFiles.length; i++) {
            const visual = visualFiles[i];
            const audio = audioFiles[i] || null;
            const text = narrations[i] || '';
            const isImg = visual.mimetype.startsWith('image/');
            const segPath = path.join(UPLOAD_DIR, `tmp_seg_${i}_${Date.now()}.mp4`);

            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();

                // Input 0: Visual (Imagem com loop ou Vídeo)
                if (isImg) {
                    cmd.input(visual.path).inputOptions(['-loop 1']);
                } else {
                    cmd.input(visual.path);
                }

                // Input 1: ÁUDIO MESTRE
                // Corrigimos o erro de mapping usando uma abordagem de canal único
                if (audio) {
                    cmd.input(audio.path);
                } else {
                    // Se não houver áudio, geramos silêncio real
                    cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi');
                }

                let videoFilters = [
                    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
                    `crop=${w}:${h}`,
                    `setsar=1/1`
                ];

                // Efeito Ken Burns para fotos
                if (isImg) {
                    videoFilters.push(`zoompan=z='min(zoom+0.0015,1.5)':x='trunc(iw/2-(iw/zoom/2))':y='trunc(ih/2-(ih/zoom/2))':s=${w}x${h}:d=1:fps=30`);
                }

                // Legendas Queimadas (Burn-in Subtitles)
                if (text && text.trim() !== '') {
                    const clean = escapeForDrawtext(text);
                    const fSize = Math.floor(h * 0.045);
                    const bMargin = Math.floor(h * 0.12);
                    videoFilters.push(`drawtext=text='${clean}':fontcolor=white:fontsize=${fSize}:box=1:boxcolor=black@0.6:boxborderw=15:x=(w-text_w)/2:y=h-th-${bMargin}`);
                }

                videoFilters.push('format=yuv420p', 'fps=30');

                // Normalização de Áudio (Crucial para a concatenação não falhar)
                const audioFilters = [
                    'aresample=44100',
                    'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
                    'volume=1.3'
                ];

                cmd.complexFilter([
                    { filter: videoFilters.join(','), inputs: '0:v', outputs: 'v_out' },
                    // Usamos '1:a' se for arquivo, ou '1' se for lavfi (silêncio)
                    // Para ser universal, usamos apenas '1' que pega o primeiro fluxo disponível do input 1
                    { filter: audioFilters.join(','), inputs: '1', outputs: 'a_out' }
                ]);

                cmd.map('v_out').map('a_out');

                // Duração: Imagens 5s, Vídeos usam o tempo do áudio/visual
                if (isImg) cmd.duration(5);

                cmd.outputOptions([
                    '-c:v libx264',
                    '-preset ultrafast', // Máxima performance
                    '-crf 22',
                    '-c:a aac',
                    '-b:a 128k',
                    '-shortest' // Corta o vídeo se o áudio for menor (evita frames pretos)
                ])
                .save(segPath)
                .on('end', () => { segmentPaths.push(segPath); resolve(); })
                .on('error', (err) => { 
                    console.error(`❌ Falha no segmento ${i}:`, err.message);
                    reject(err); 
                });
            });
        }

        // --- CONCATENAÇÃO FINAL ---
        if (segmentPaths.length === 0) throw new Error("Nenhum segmento foi gerado com sucesso.");

        const concatCmd = ffmpeg();
        segmentPaths.forEach(s => concatCmd.input(s));
        
        const filterInputs = segmentPaths.map((_, idx) => `[${idx}:v][${idx}:a]`).join('');
        const concatFilter = `${filterInputs}concat=n=${segmentPaths.length}:v=1:a=1[v][a]`;

        concatCmd.complexFilter(concatFilter)
            .map('[v]').map('[a]')
            .outputOptions([
                '-c:v libx264',
                '-preset medium',
                '-crf 18', // Qualidade Master
                '-c:a aac',
                '-movflags +faststart'
            ])
            .save(finalOutputPath)
            .on('end', () => {
                // Limpeza de arquivos temporários
                segmentPaths.forEach(s => fs.unlink(s, () => {}));
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${finalOutputName}` });
            })
            .on('error', (err) => {
                console.error("❌ Erro na finalização:", err.message);
                res.status(500).send(`Erro na Finalização: ${err.message}`);
            });

    } catch (error) {
        console.error("❌ ERRO CRÍTICO TURBO:", error.message);
        res.status(500).send(`Erro de Renderização: ${error.message}`);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 MOTOR TURBO v3.6 ATIVO NA PORTA ${PORT}`));
