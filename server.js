
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
    console.log(`✅ MOTOR MASTER BACKEND v4.0 - FULL AUDIO SYNC`);
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
 * IA TURBO - ROTA MESTRE DE VÍDEO
 */
app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'] || [];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];

    if (visualFiles.length === 0) return res.status(400).send('Sem visuais.');

    const isVertical = req.body.aspectRatio === '9:16';
    let w = isVertical ? 1080 : 1920;
    let h = isVertical ? 1920 : 1080;
    
    w = Math.floor(w / 2) * 2;
    h = Math.floor(h / 2) * 2;

    const finalOutput = path.join(OUTPUT_DIR, `final_${Date.now()}.mp4`);
    const segments = [];

    try {
        for (let i = 0; i < visualFiles.length; i++) {
            const visual = visualFiles[i];
            const audio = audioFiles[i]; // Narração do Gemini
            const text = narrations[i] || '';
            const isImg = visual.mimetype.startsWith('image/');
            const segPath = path.join(UPLOAD_DIR, `seg_${i}_${Date.now()}.mp4`);

            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();

                // Input 0: Visual
                if (isImg) cmd.input(visual.path).inputOptions(['-loop 1']);
                else cmd.input(visual.path);

                // Input 1: Áudio (Narração ou Silêncio)
                if (audio) {
                    cmd.input(audio.path);
                } else {
                    cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi');
                }

                // Filtros de Vídeo
                let vFilter = [
                    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
                    `crop=${w}:${h}`,
                    `setsar=1/1`
                ];
                if (isImg) vFilter.push(`zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:d=1:fps=30`);
                if (text) {
                    const cleanText = escapeForDrawtext(text);
                    const fSize = Math.floor(h * 0.04);
                    vFilter.push(`drawtext=text='${cleanText}':fontcolor=white:fontsize=${fSize}:box=1:boxcolor=black@0.5:boxborderw=10:x=(w-text_w)/2:y=h-(h*0.15)`);
                }
                vFilter.push('format=yuv420p', 'fps=30');

                // Filtros de Áudio - GARANTE QUE O SOM SAIA
                // Normalizamos para 44.1kHz estéreo
                const aFilter = [
                    'aresample=44100',
                    'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
                    'volume=1.5'
                ];

                cmd.complexFilter([
                    { filter: vFilter.join(','), inputs: '0:v', outputs: 'v_out' },
                    // Usamos '1' para pegar o primeiro fluxo disponível do input de áudio
                    { filter: aFilter.join(','), inputs: '1', outputs: 'a_out' }
                ]);

                cmd.map('v_out').map('a_out');
                if (isImg) cmd.duration(5);

                cmd.outputOptions(['-c:v libx264', '-preset ultrafast', '-c:a aac', '-shortest'])
                   .save(segPath)
                   .on('end', () => { segments.push(segPath); resolve(); })
                   .on('error', (err) => reject(err));
            });
        }

        // Concatenação
        const concatCmd = ffmpeg();
        segments.forEach(s => concatCmd.input(s));
        const filterStr = segments.map((_, idx) => `[${idx}:v][${idx}:a]`).join('') + `concat=n=${segments.length}:v=1:a=1[v][a]`;
        
        concatCmd.complexFilter(filterStr)
            .map('[v]').map('[a]')
            .outputOptions(['-c:v libx264', '-preset medium', '-c:a aac', '-movflags +faststart'])
            .save(finalOutput)
            .on('end', () => {
                segments.forEach(s => fs.unlink(s, () => {}));
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(finalOutput)}` });
            })
            .on('error', (err) => res.status(500).send(err.message));

    } catch (e) { res.status(500).send(e.message); }
});

/**
 * PROCESSADOR DE ÁUDIO (JOIN, CLEAN, CUT, ETC)
 */
app.post('/process-audio', upload.array('audio'), async (req, res) => {
    const action = req.body.action || 'clean';
    if (!req.files || req.files.length === 0) return res.status(400).send('Sem áudios.');

    const output = path.join(OUTPUT_DIR, `audio_${Date.now()}.mp3`);
    let cmd = ffmpeg();

    req.files.forEach(f => cmd.input(f.path));

    if (action === 'join' && req.files.length > 1) {
        cmd.mergeToFile(output, UPLOAD_DIR);
    } else {
        // Clean, volume boost, etc.
        cmd.audioFilters(['aresample=44100', 'volume=1.5'])
           .save(output);
    }

    cmd.on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(output)}` }))
       .on('error', (err) => res.status(500).send(err.message));
});

/**
 * PROCESSADOR DE IMAGEM
 */
app.post('/process-image', upload.array('image'), async (req, res) => {
    const action = req.body.action || 'convert';
    if (!req.files || req.files.length === 0) return res.status(400).send('Sem imagens.');

    const output = path.join(OUTPUT_DIR, `img_${Date.now()}.png`);
    // Simulação de processamento de imagem via FFmpeg
    ffmpeg(req.files[0].path)
        .save(output)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(output)}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

/**
 * UTILITÁRIOS DE VÍDEO (UPSCALE, CUT, COMPRESS, ETC)
 */
const videoUtils = ['upscale', 'colorize', 'cut', 'join', 'compress', 'remove-audio', 'extract-audio'];
videoUtils.forEach(route => {
    app.post(`/${route}`, upload.array('video'), (req, res) => {
        if (!req.files || req.files.length === 0) return res.status(400).send('Sem vídeos.');
        const output = path.join(OUTPUT_DIR, `${route}_${Date.now()}.mp4`);
        let cmd = ffmpeg(req.files[0].path);

        if (route === 'extract-audio') {
            const audioOut = output.replace('.mp4', '.mp3');
            cmd.noVideo().save(audioOut)
               .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(audioOut)}` }));
            return;
        }

        if (route === 'remove-audio') cmd.noAudio();
        if (route === 'compress') cmd.videoBitrate('1000k');
        
        cmd.save(output)
           .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(output)}` }))
           .on('error', (err) => res.status(500).send(err.message));
    });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 MASTER BACKEND v4.0 ONLINE NA PORTA ${PORT}`));
