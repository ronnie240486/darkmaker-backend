
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const https = require('https');

// --- FFMPEG CONFIGURATION ---
let ffmpegPath, ffprobePath;
try {
    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    ffprobePath = require('@ffprobe-installer/ffprobe').path;
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
    process.env.FFMPEG_PATH = ffmpegPath;
    process.env.FFPROBE_PATH = ffprobePath;
    console.log(`✅ FFmpeg Engine: Professional Mode Active.`);
} catch (error) {
    console.error("❌ FFmpeg path error:", error);
}

const app = express();
const PORT = process.env.PORT || 8080;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(OUTPUT_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    cb(null, `raw_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`);
  }
});
const upload = multer({ storage: storage });

function sanitizeForFFmpeg(text) {
    if (!text) return ' ';
    return text
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "'\\\\''")
        .replace(/:/g, '\\:')
        .replace(/,/g, '\\,')
        .replace(/%/g, '\\%');
}

/**
 * Downloads a file from a URL to a local path.
 * Used to bypass browser CORS when assembling the video.
 */
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(dest);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

/**
 * IA TURBO / MASTER RENDER V4
 * Resilient rendering pipeline handling local files and remote URLs.
 */
app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'] || [];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
    const visualUrls = req.body.visualUrls ? JSON.parse(req.body.visualUrls) : [];
    const audioUrls = req.body.audioUrls ? JSON.parse(req.body.audioUrls) : [];

    // Total length is determined by the number of visual assets
    const totalScenes = Math.max(visualFiles.length, visualUrls.length);
    if (totalScenes === 0) return res.status(400).send('No visuals provided.');

    const resolution = req.body.resolution || '1080p';
    const isVertical = req.body.aspectRatio === '9:16';
    const targetW = isVertical ? 1080 : (resolution === '4K' ? 3840 : 1920);
    const targetH = isVertical ? 1920 : (resolution === '4K' ? 2160 : 1080);

    const outputFilename = `master_export_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    const segmentPaths = [];
    const tempFiles = [];

    try {
        for (let i = 0; i < totalScenes; i++) {
            let visualPath = visualFiles[i]?.path;
            const visualUrl = visualUrls[i];
            const audioPath = audioFiles[i]?.path;
            const audioUrl = audioUrls[i];
            const text = narrations[i] || '';

            // If file is missing but URL is provided, download it locally
            if (!visualPath && visualUrl) {
                const dest = path.join(UPLOAD_DIR, `remote_v_${i}_${Date.now()}.mp4`);
                await downloadFile(visualUrl, dest);
                visualPath = dest;
                tempFiles.push(dest);
            }

            if (!visualPath) continue;

            const segmentPath = path.join(UPLOAD_DIR, `seg_v4_${i}_${Date.now()}.mp4`);
            const isImage = /\.(jpg|jpeg|png|webp)$/i.test(visualPath) || (visualFiles[i] && visualFiles[i].mimetype.startsWith('image/'));
            
            let currentAudioPath = audioPath;
            if (!currentAudioPath && audioUrl) {
                const dest = path.join(UPLOAD_DIR, `remote_a_${i}_${Date.now()}.wav`);
                await downloadFile(audioUrl, dest);
                currentAudioPath = dest;
                tempFiles.push(dest);
            }

            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();
                if (isImage) cmd.input(visualPath).inputOptions(['-loop 1']);
                else cmd.input(visualPath);

                if (currentAudioPath) cmd.input(currentAudioPath);
                else cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi');

                let videoFilters = [];
                if (isImage) {
                    videoFilters.push(`scale=4000:4000:force_original_aspect_ratio=increase`, `crop=4000:4000`);
                    videoFilters.push(`zoompan=z='min(zoom+0.001,1.2)':d=150:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${targetW}x${targetH}`);
                } else {
                    videoFilters.push(`scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`, `crop=${targetW}:${targetH}`);
                }

                if (text && text.trim().length > 0) {
                    const cleanText = sanitizeForFFmpeg(text);
                    const fontSize = Math.floor(targetH * 0.045);
                    const boxMargin = Math.floor(targetH * 0.1);
                    videoFilters.push(`drawtext=text='${cleanText}':fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.5:boxborderw=20:line_spacing=10:x=(w-text_w)/2:y=h-th-${boxMargin}:fix_bounds=1`);
                }

                videoFilters.push(`format=yuv420p`, `fps=30`);

                cmd.complexFilter([
                    { filter: videoFilters.join(','), inputs: '0:v', outputs: 'v_out' },
                    { filter: 'aresample=44100,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=1.2', inputs: '1:a', outputs: 'a_out' }
                ])
                .map('v_out').map('a_out');

                if (isImage) cmd.duration(5);

                cmd.outputOptions(['-c:v libx264', '-preset fast', '-crf 22', '-c:a aac', '-b:a 192k', '-shortest'])
                .save(segmentPath)
                .on('end', () => { segmentPaths.push(segmentPath); resolve(); })
                .on('error', (err) => { console.error(`Seg ${i} Error:`, err.message); reject(err); });
            });
        }

        const finalCmd = ffmpeg();
        segmentPaths.forEach(p => finalCmd.input(p));
        const filterStr = segmentPaths.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${segmentPaths.length}:v=1:a=1[v][a]`;

        finalCmd.complexFilter(filterStr)
            .map('[v]').map('[a]')
            .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-c:a aac', '-shortest'])
            .save(outputPath)
            .on('end', () => {
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` });
                [...segmentPaths, ...tempFiles].forEach(p => fs.unlink(p, () => {}));
            })
            .on('error', (err) => res.status(500).send(`Render Finalization Error: ${err.message}`));

    } catch (error) {
        console.error("Turbo Failure:", error.message);
        res.status(500).send(`Export Error: ${error.message}`);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Pro Render Engine Active on port ${PORT}`));
