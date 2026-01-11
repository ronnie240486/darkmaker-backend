
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
    "https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/static/Roboto-Bold.ttf"
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
                    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) resolve(true);
                    else { fs.unlink(dest, () => {}); reject(new Error('File too small')); }
                });
            });
        }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
    });
};

const downloadFont = async () => {
    if (fs.existsSync(FONT_PATH) && fs.statSync(FONT_PATH).size > 1000) return;
    for (const url of FONT_URLS) {
        try { await downloadFile(url, FONT_PATH); console.log("✅ Font installed."); return; } 
        catch (e) { console.warn(`⚠️ Font mirror failed: ${e.message}`); }
    }
    console.warn("⚠️ Subtitles will be disabled (Font download failed).");
};
downloadFont();

const app = express();
const PORT = 3001;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use('/outputs', express.static(OUTPUT_DIR));

const upload = multer({ 
    storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        filename: (req, file, cb) => cb(null, `raw_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
    }),
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

function sanitizeForFFmpeg(text) {
    if (!text) return '';
    return text.replace(/\\/g, '\\\\').replace(/'/g, "'\\\\''").replace(/:/g, '\\:').replace(/,/g, '\\,').replace(/%/g, '\\%').replace(/\n/g, ' ').replace(/\r/g, '');
}

// Helper to extract index from filename (v_0_scene.mp4 -> 0)
const getIndex = (filename) => {
    const match = filename.match(/[a-z]_(\d+)_/);
    return match ? parseInt(match[1]) : 9999;
};

app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    console.log("🎬 Start IA Turbo Render Job");
    
    // SORT FILES BY INDEX TO ENSURE SYNC
    const visualFiles = (req.files['visuals'] || []).sort((a, b) => getIndex(a.originalname) - getIndex(b.originalname));
    const audioFiles = (req.files['audios'] || []).sort((a, b) => getIndex(a.originalname) - getIndex(b.originalname));
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];

    if (!visualFiles || visualFiles.length === 0) return res.status(400).send('No visuals provided.');

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
            const visual = visualFiles[i];
            const audio = audioFiles[i]; // Now guaranteed to match index i
            const text = narrations[i] || '';
            const segmentPath = path.join(UPLOAD_DIR, `seg_${i}_${Date.now()}.mp4`);
            
            console.log(`🔹 Processing Seg ${i}: Visual=${visual.originalname} Audio=${audio ? audio.originalname : 'None'}`);

            const isImage = visual.mimetype.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(visual.originalname);
            
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();

                cmd.input(path.resolve(visual.path));
                if (isImage) {
                    // Critical: Explicit duration to prevent infinite loops
                    cmd.inputOptions(['-loop 1', '-t 15']); 
                }

                if (audio && fs.existsSync(audio.path)) {
                    cmd.input(path.resolve(audio.path));
                } else {
                    cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi').inputOptions(['-t 5']);
                }

                let videoFilters = [];
                // Scale calculations (even dimensions required)
                const scaleBase = isVertical ? 2880 : 3840;

                if (isImage) {
                    videoFilters.push(`scale=${scaleBase}:${scaleBase}:force_original_aspect_ratio=increase`);
                    videoFilters.push(`crop=${scaleBase}:${scaleBase}`);
                    videoFilters.push(`zoompan=z='min(zoom+0.001,1.2)':d=450:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${targetW}x${targetH}:fps=30`);
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

                videoFilters.push('format=yuv420p'); // Ensure compatibility

                cmd.complexFilter([
                    { filter: videoFilters.join(','), inputs: '0:v', outputs: 'v_out' },
                    { filter: 'aresample=44100', inputs: '1:a', outputs: 'a_out' }
                ]);

                cmd.map('v_out');
                cmd.map('a_out');
                
                // Truncate to shortest stream (usually audio, or hard limit on image)
                cmd.outputOptions(['-shortest']); 

                cmd.outputOptions([
                    '-c:v libx264', '-preset ultrafast', '-crf 28', 
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

        console.log("🔗 Concatenating...");
        const finalCmd = ffmpeg();
        segmentPaths.forEach(p => finalCmd.input(p));
        
        const inputs = segmentPaths.map((_, i) => `[${i}:v][${i}:a]`).join('');
        
        finalCmd.complexFilter(`${inputs}concat=n=${segmentPaths.length}:v=1:a=1[v][a]`)
            .map('[v]').map('[a]')
            .outputOptions(['-c:v libx264', '-preset ultrafast', '-c:a aac', '-y'])
            .save(outputPath)
            .on('end', () => {
                console.log("✅ Render Complete");
                // Lazy cleanup
                setTimeout(() => {
                    try {
                        segmentPaths.forEach(p => fs.unlink(p, () => {}));
                        visualFiles.forEach(f => fs.unlink(f.path, () => {}));
                        audioFiles.forEach(f => fs.unlink(f.path, () => {}));
                    } catch(e) {}
                }, 5000);
                
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
