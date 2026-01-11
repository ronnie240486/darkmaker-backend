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
    console.log(`✅ FFmpeg Engine: Professional Mode Active. Path: ${ffmpegPath}`);
} catch (error) {
    console.error("❌ FFmpeg path error:", error);
}

// --- FONT CONFIGURATION ---
const FONT_FILENAME = 'Roboto-Bold.ttf';
const FONT_PATH = path.join(__dirname, FONT_FILENAME);

const FONT_URLS = [
    "https://github.com/googlefonts/roboto/raw/main/src/hinted/Roboto-Bold.ttf",
    "https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/static/Roboto-Bold.ttf",
    "https://raw.githubusercontent.com/StellarCN/roboto-font/master/Roboto-Bold.ttf"
];

const downloadFile = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, response => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                file.close(() => { fs.unlink(dest, () => {}); reject(new Error(`Status ${response.statusCode}`)); });
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    const stats = fs.statSync(dest);
                    if (stats.size < 1000) {
                        fs.unlink(dest, () => {});
                        reject(new Error('File too small'));
                    } else {
                        resolve(true);
                    }
                });
            });
        }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
    });
};

const downloadFont = async () => {
    if (fs.existsSync(FONT_PATH) && fs.statSync(FONT_PATH).size > 1000) return;
    console.log("⬇️ Downloading font...");
    for (const url of FONT_URLS) {
        try {
            await downloadFile(url, FONT_PATH);
            console.log("✅ Font installed.");
            return;
        } catch (e) { console.warn(`❌ Font Mirror Failed: ${e.message}`); }
    }
    console.error("❌ Font download failed. Subtitles disabled.");
};
downloadFont();

const app = express();
const PORT = 3001;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(OUTPUT_DIR));

const upload = multer({ 
    storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        filename: (req, file, cb) => cb(null, `raw_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`)
    })
});

function sanitizeForFFmpeg(text) {
    if (!text) return '';
    return text.replace(/\\/g, '\\\\').replace(/'/g, "'\\\\''").replace(/:/g, '\\:').replace(/,/g, '\\,').replace(/%/g, '\\%').replace(/\n/g, ' ').replace(/\r/g, '');
}

app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    console.log("🎬 Start IA Turbo Render Job");
    const visualFiles = req.files['visuals'];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];

    if (!visualFiles || visualFiles.length === 0) return res.status(400).send('No visuals.');

    const isVertical = req.body.aspectRatio === '9:16';
    const targetW = isVertical ? 1080 : 1920;
    const targetH = isVertical ? 1920 : 1080;
    const outputFilename = `master_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    const fontAvailable = fs.existsSync(FONT_PATH) && fs.statSync(FONT_PATH).size > 1000;
    const fontPathFilter = fontAvailable ? FONT_PATH.replace(/\\/g, '/').replace(/:/g, '\\:') : '';

    try {
        const segmentPaths = [];

        for (let i = 0; i < visualFiles.length; i++) {
            console.log(`🔹 Rendering Segment ${i+1}/${visualFiles.length}`);
            const visual = visualFiles[i];
            const audio = audioFiles[i]; // Assumes 1:1 mapping ensured by frontend
            const text = narrations[i] || '';
            const segmentPath = path.join(UPLOAD_DIR, `seg_${i}_${Date.now()}.mp4`);
            
            const isImage = visual.mimetype.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(visual.originalname);
            
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();

                // Input 0: Visual
                cmd.input(path.resolve(visual.path));
                if (isImage) {
                    // Force duration on input to prevent infinite loops
                    cmd.inputOptions(['-loop 1', '-t 10']); // Cap max slide duration to 10s if audio is missing/short
                }

                // Input 1: Audio
                if (audio && fs.existsSync(audio.path)) {
                    cmd.input(path.resolve(audio.path));
                } else {
                    // Use lavfi to generate 5 seconds of silence if no audio
                    cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi').inputOptions(['-t 5']);
                }

                let videoFilters = [];
                const scaleBase = isVertical ? 2880 : 3840;

                if (isImage) {
                    videoFilters.push(`scale=${scaleBase}:${scaleBase}:force_original_aspect_ratio=increase`);
                    videoFilters.push(`crop=${scaleBase}:${scaleBase}`);
                    // Zoompan: duration (d) needs to cover the max length (e.g. 10s * 30fps = 300)
                    videoFilters.push(`zoompan=z='min(zoom+0.001,1.2)':d=300:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${targetW}x${targetH}:fps=30`);
                } else {
                    videoFilters.push(`scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`);
                    videoFilters.push(`crop=${targetW}:${targetH}`);
                }

                if (text && fontAvailable) {
                    const cleanText = sanitizeForFFmpeg(text);
                    const fontSize = Math.floor(targetH * 0.045);
                    const boxMargin = Math.floor(targetH * 0.1);
                    const escapedFontPath = fontPathFilter.replace(/'/g, "\\'");
                    videoFilters.push(`drawtext=fontfile='${escapedFontPath}':text='${cleanText}':fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.5:boxborderw=20:line_spacing=10:x=(w-text_w)/2:y=h-th-${boxMargin}`);
                }

                videoFilters.push(`format=yuv420p`);

                cmd.complexFilter([
                    { filter: videoFilters.join(','), inputs: '0:v', outputs: 'v_out' },
                    { filter: 'aresample=44100', inputs: '1:a', outputs: 'a_out' }
                ]);

                cmd.map('v_out');
                cmd.map('a_out');
                
                // Use shortest to cut video to audio length (or vice versa if audio is silent placeholder)
                cmd.outputOptions(['-shortest']); 

                cmd.outputOptions([
                    '-c:v libx264', '-preset superfast', '-crf 26', 
                    '-c:a aac', '-b:a 128k', 
                    '-y'
                ])
                .save(segmentPath)
                .on('end', () => { 
                    segmentPaths.push(segmentPath); 
                    resolve(); 
                })
                .on('error', (err) => {
                    console.error(`❌ Error Seg ${i}:`, err.message);
                    reject(err);
                });
            });
        }

        console.log("🔗 Concatenating Segments...");
        const finalCmd = ffmpeg();
        segmentPaths.forEach(p => finalCmd.input(p));
        
        const inputs = segmentPaths.map((_, i) => `[${i}:v][${i}:a]`).join('');
        
        finalCmd.complexFilter(`${inputs}concat=n=${segmentPaths.length}:v=1:a=1[v][a]`)
            .map('[v]').map('[a]')
            .outputOptions(['-c:v libx264', '-preset superfast', '-c:a aac', '-y'])
            .save(outputPath)
            .on('end', () => {
                console.log("✅ Master Render Complete");
                // Cleanup
                try {
                    segmentPaths.forEach(p => fs.unlink(p, () => {}));
                    visualFiles.forEach(f => fs.unlink(f.path, () => {}));
                    audioFiles.forEach(f => fs.unlink(f.path, () => {}));
                } catch(e) {}
                
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` });
            })
            .on('error', (err) => {
                console.error("❌ Concat Error:", err.message);
                res.status(500).send(err.message);
            });

    } catch (error) {
        console.error("❌ Job Failed:", error.message);
        res.status(500).send(error.message);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
