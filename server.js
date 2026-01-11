
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const https = require('https');

// --- CONFIGURAÇÃO DE BINÁRIOS ---
let ffmpegPath, ffprobePath;
try {
    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    ffprobePath = require('@ffprobe-installer/ffprobe').path;
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
} catch (error) {
    console.warn("⚠️ Usando binários do sistema para FFmpeg.");
}

// --- CONFIGURAÇÃO DE FONTE ---
const FONT_FILENAME = 'Roboto-Bold.ttf';
const FONT_PATH = path.join(__dirname, FONT_FILENAME);
const downloadFont = async () => {
    if (fs.existsSync(FONT_PATH)) return;
    const url = "https://github.com/googlefonts/roboto/raw/main/src/hinted/Roboto-Bold.ttf";
    const file = fs.createWriteStream(FONT_PATH);
    https.get(url, res => {
        if (res.statusCode === 200) {
            res.pipe(file);
        }
    });
};
downloadFont();

const app = express();
const PORT = 8080;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use('/outputs', express.static(OUTPUT_DIR));

app.get('/health', (req, res) => res.json({ status: 'online' }));

const upload = multer({ dest: UPLOAD_DIR });

function sanitize(text) {
    if (!text) return '';
    return text
        .replace(/\\/g, '\\\\\\\\')
        .replace(/'/g, "'\\''")
        .replace(/:/g, '\\:')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;')
        .replace(/%/g, '\\%');
}

app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }, { name: 'bgMusic' }]), async (req, res) => {
    console.log("🚀 Iniciando Masterização Robusta...");
    
    const visualFiles = req.files['visuals'] || [];
    const audioFiles = req.files['audios'] || [];
    const bgMusicFile = req.files['bgMusic'] ? req.files['bgMusic'][0] : null;
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
    const isVertical = req.body.aspectRatio === '9:16';
    const targetW = isVertical ? 1080 : 1920;
    const targetH = isVertical ? 1920 : 1080;

    const outputFilename = `master_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    const segments = [];

    try {
        for (let i = 0; i < visualFiles.length; i++) {
            const visual = visualFiles[i];
            const audio = audioFiles[i];
            const text = narrations[i] || '';
            const segPath = path.join(UPLOAD_DIR, `seg_${i}_${Date.now()}.mp4`);
            const isImg = /\.(jpg|jpeg|png|webp|gif)$/i.test(visual.originalname);

            console.log(`🎬 Processando Cena ${i + 1}: ${isImg ? 'IMAGEM' : 'VÍDEO'}`);

            await new Promise((resolve, reject) => {
                let cmd = ffmpeg(visual.path);
                
                if (isImg) {
                    // Loop de 6 segundos para imagens
                    cmd.inputOptions(['-loop 1', '-t 6']);
                }

                if (audio) {
                    cmd.input(audio.path);
                } else {
                    cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi').inputOptions(['-t 6']);
                }

                let vFilters = [];
                if (isImg) {
                    // Ken Burns Effect otimizado para evitar erro de escala
                    vFilters.push(`scale=iw*2:-1,zoompan=z='min(zoom+0.0015,1.5)':d=180:s=${targetW}x${targetH}:fps=30`);
                } else {
                    vFilters.push(`scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1`);
                }

                if (text && fs.existsSync(FONT_PATH)) {
                    const fontSize = Math.floor(targetH * 0.04);
                    const yPos = Math.floor(targetH * 0.85);
                    const cleanText = sanitize(text);
                    vFilters.push(`drawtext=fontfile='${FONT_PATH.replace(/\\/g, '/')}:text='${cleanText}':fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.5:boxborderw=15:x=(w-text_w)/2:y=${yPos}`);
                }

                vFilters.push('format=yuv420p');

                cmd.complexFilter([
                    { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_out' },
                    // Sincroniza áudio: se for menor que o vídeo, completa com silêncio
                    { filter: 'aresample=44100,apad', inputs: '1:a', outputs: 'a_out' }
                ])
                .map('v_out')
                .map('a_out')
                .outputOptions([
                    '-c:v libx264',
                    '-preset fast',
                    '-crf 22',
                    '-r 30',
                    '-t 6' // Força duração constante por cena para estabilidade
                ])
                .save(segPath)
                .on('end', () => { segments.push(segPath); resolve(); })
                .on('error', (err) => {
                    console.error(`❌ Erro Cena ${i}:`, err.message);
                    reject(err);
                });
            });
        }

        if (segments.length === 0) throw new Error("Falha ao gerar segmentos.");

        console.log("🔗 Unindo cenas...");
        let finalCmd = ffmpeg();
        segments.forEach(s => finalCmd.input(s));
        if (bgMusicFile) finalCmd.input(bgMusicFile.path);

        const concatStr = segments.map((_, i) => `[${i}:v][${i}:a]`).join('');
        let filterStr = `${concatStr}concat=n=${segments.length}:v=1:a=1[vv][aa];`;

        if (bgMusicFile) {
            filterStr += `[aa]volume=1.5[a1];[${segments.length}:a]volume=0.1,dynaudnorm[a2];[a1][a2]amix=inputs=2:duration=first[afinal]`;
        } else {
            filterStr += `[aa]copy[afinal]`;
        }

        finalCmd.complexFilter(filterStr)
            .map('[vv]')
            .map('[afinal]')
            .outputOptions(['-c:v libx264', '-preset medium', '-crf 18', '-c:a aac', '-y'])
            .save(outputPath)
            .on('end', () => {
                console.log("✅ Concluído!");
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` });
                
                // Cleanup tardio
                setTimeout(() => {
                    segments.forEach(s => fs.existsSync(s) && fs.unlinkSync(s));
                }, 30000);
            })
            .on('error', (err) => res.status(500).send(err.message));

    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.listen(PORT, () => console.log(`🚀 Motor Master Pro na porta ${PORT}`));
