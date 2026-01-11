
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
    console.log(`✅ MOTOR TURBO MASTER v5.1 - MAGIC WORKFLOW & IA TURBO ATIVOS`);
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
 * MOTOR DE PROCESSAMENTO DE CENA ÚNICA
 */
const processScene = async (visual, audio, text, index, w, h, isImg, UPLOAD_DIR) => {
    const segPath = path.join(UPLOAD_DIR, `seg_${index}_${Date.now()}.mp4`);
    
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg();

        if (isImg) cmd.input(visual.path).inputOptions(['-loop 1']);
        else cmd.input(visual.path);

        if (audio) {
            cmd.input(audio.path);
        } else {
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
            const fSize = Math.floor(h * 0.035);
            vFilters.push(`drawtext=text='${cleanText}':fontcolor=white:fontsize=${fSize}:box=1:boxcolor=black@0.6:boxborderw=15:x=(w-text_w)/2:y=h-(h*0.18):line_spacing=10`);
        }

        vFilters.push(`fade=t=in:st=0:d=0.5`, `fade=t=out:st=4.5:d=0.5`);
        vFilters.push('format=yuv420p', 'fps=30');

        let aFilters = [
            'aresample=44100',
            'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
            'volume=1.8',
            'afade=t=in:st=0:d=0.3',
            'afade=t=out:st=4.7:d=0.3'
        ];

        cmd.complexFilter([
            { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_processed' },
            { filter: aFilters.join(','), inputs: '1:a', outputs: 'a_processed' }
        ]);

        cmd.map('v_processed').map('a_processed');
        cmd.duration(5);

        cmd.outputOptions(['-c:v libx264', '-preset ultrafast', '-c:a aac', '-shortest'])
            .save(segPath)
            .on('end', () => resolve(segPath))
            .on('error', (err) => reject(err));
    });
};

/**
 * LÓGICA DE CONCATENAÇÃO MESTRE
 */
const concatSegments = async (segments, finalOutput) => {
    return new Promise((resolve, reject) => {
        const concatCmd = ffmpeg();
        segments.forEach(s => concatCmd.input(s));

        const filterStr = segments.map((_, idx) => `[${idx}:v][${idx}:a]`).join('') + `concat=n=${segments.length}:v=1:a=1[v][a]`;
        
        concatCmd.complexFilter(filterStr)
            .map('[v]').map('[a]')
            .outputOptions(['-c:v libx264', '-preset medium', '-crf 22', '-c:a aac', '-movflags +faststart'])
            .save(finalOutput)
            .on('end', () => resolve())
            .on('error', (err) => reject(err));
    });
};

/**
 * ROTA: MAGIC WORKFLOW
 * Otimizada para o fluxo de "1 Tópico = 1 Vídeo"
 */
app.post('/magic-workflow', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'] || [];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
    
    if (visualFiles.length === 0) return res.status(400).send('Sem mídia para o Workflow.');

    const w = 1920, h = 1080; // Padrão paisagem para Workflow
    const finalOutput = path.join(OUTPUT_DIR, `magic_${Date.now()}.mp4`);
    const segments = [];

    try {
        console.log(`✨ Executando Magic Workflow: ${visualFiles.length} cenas...`);
        for (let i = 0; i < visualFiles.length; i++) {
            const seg = await processScene(visualFiles[i], audioFiles[i], narrations[i], i, w, h, visualFiles[i].mimetype.startsWith('image/'), UPLOAD_DIR);
            segments.push(seg);
        }
        await concatSegments(segments, finalOutput);
        segments.forEach(s => fs.unlink(s, () => {}));
        res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(finalOutput)}` });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

/**
 * ROTA: IA TURBO
 */
app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'] || [];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
    const aspectRatio = req.body.aspectRatio || '16:9';

    const isVertical = aspectRatio === '9:16';
    const w = isVertical ? 1080 : 1920;
    const h = isVertical ? 1920 : 1080;

    const finalOutput = path.join(OUTPUT_DIR, `turbo_${Date.now()}.mp4`);
    const segments = [];

    try {
        console.log(`🚀 Executando IA Turbo Render...`);
        for (let i = 0; i < visualFiles.length; i++) {
            const seg = await processScene(visualFiles[i], audioFiles[i], narrations[i], i, w, h, visualFiles[i].mimetype.startsWith('image/'), UPLOAD_DIR);
            segments.push(seg);
        }
        await concatSegments(segments, finalOutput);
        segments.forEach(s => fs.unlink(s, () => {}));
        res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(finalOutput)}` });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 MASTER ENGINE v5.1 ONLINE NA PORTA ${PORT}`));
