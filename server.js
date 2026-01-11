
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

// Correct URLs for Roboto Bold (OFL version)
const FONT_URLS = [
    "https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/static/Roboto-Bold.ttf",
    "https://github.com/google/fonts/raw/main/ofl/roboto/static/Roboto-Bold.ttf"
];

const downloadFile = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, response => {
            if (response.statusCode !== 200) {
                file.close(() => {
                    fs.unlink(dest, () => {}); // Delete partial/empty file
                    reject(new Error(`Status ${response.statusCode}`));
                });
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    // Double check size to ensure it's not a text error page
                    const stats = fs.statSync(dest);
                    if (stats.size < 1000) {
                        fs.unlink(dest, () => {});
                        reject(new Error('Downloaded file too small (likely invalid)'));
                    } else {
                        resolve(true);
                    }
                });
            });
        }).on('error', err => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
};

const downloadFont = async () => {
    const tempPath = path.join(__dirname, `${FONT_FILENAME}.tmp`);
    
    // Check if valid font already exists
    if (fs.existsSync(FONT_PATH) && fs.statSync(FONT_PATH).size > 1000) {
        console.log("✅ Font verified present.");
        return;
    }

    console.log("⬇️ Attempting to download font...");
    
    for (const url of FONT_URLS) {
        try {
            console.log(`Trying ${url}...`);
            await downloadFile(url, tempPath);
            
            // If successful, move temp to final
            if (fs.existsSync(FONT_PATH)) fs.unlinkSync(FONT_PATH);
            fs.renameSync(tempPath, FONT_PATH);
            
            console.log("✅ Font installed successfully.");
            return;
        } catch (e) {
            console.warn(`❌ Failed ${url}: ${e.message}`);
        }
    }
    console.error("❌ All font download attempts failed. Subtitles will be disabled.");
};

// Start download but don't block server startup
downloadFont();

const app = express();
// FORCE PORT 3001 to avoid conflict with Vite (which defaults to 8080 or is set to 8080)
// This prevents "Failed to fetch" caused by backend stealing the frontend port
const PORT = 3001; 

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
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    cb(null, `raw_${Date.now()}_${safeName}`);
  }
});
const upload = multer({ storage: storage });

function sanitizeForFFmpeg(text) {
    if (!text) return '';
    return text
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "'\\\\''")
        .replace(/:/g, '\\:')
        .replace(/,/g, '\\,')
        .replace(/%/g, '\\%')
        .replace(/\n/g, ' ')
        .replace(/\r/g, '');
}

/**
 * IA TURBO / MASTER RENDER V3
 */
app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];

    if (!visualFiles || visualFiles.length === 0) return res.status(400).send('No visuals provided.');

    const resolution = req.body.resolution || '1080p';
    const isVertical = req.body.aspectRatio === '9:16';
    
    const targetW = isVertical ? 1080 : (resolution === '4K' ? 3840 : 1920);
    const targetH = isVertical ? 1920 : (resolution === '4K' ? 2160 : 1080);

    const outputFilename = `master_export_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    // CRITICAL CHECK: Verify font existence before using it in filters
    const fontAvailable = fs.existsSync(FONT_PATH) && fs.statSync(FONT_PATH).size > 1000;
    
    // Improved path escaping for Windows/Unix compatibility in FFmpeg filter strings
    let fontPathFilter = '';
    if (fontAvailable) {
        // Absolute path with forward slashes for FFmpeg compatibility
        fontPathFilter = FONT_PATH.replace(/\\/g, '/').replace(/:/g, '\\:');
    }

    try {
        const segmentPaths = [];

        for (let i = 0; i < visualFiles.length; i++) {
            const visual = visualFiles[i];
            const audio = audioFiles[i] || null;
            const text = narrations[i] || '';
            const segmentPath = path.join(UPLOAD_DIR, `seg_final_${i}_${Date.now()}.mp4`);
            
            if (!fs.existsSync(visual.path)) continue;

            const isImage = visual.mimetype.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(visual.originalname);
            
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();

                cmd.input(path.resolve(visual.path));
                if (isImage) cmd.inputOptions(['-loop 1']);

                if (audio && fs.existsSync(audio.path)) {
                    cmd.input(path.resolve(audio.path));
                } else {
                    cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi');
                }

                let videoFilters = [];
                const scaleBase = isVertical ? 2880 : 3840;

                if (isImage) {
                    videoFilters.push(`scale=${scaleBase}:${scaleBase}:force_original_aspect_ratio=increase`);
                    videoFilters.push(`crop=${scaleBase}:${scaleBase}`);
                    // Ensure output is scaled to target resolution at the end of zoompan
                    videoFilters.push(`zoompan=z='min(zoom+0.001,1.2)':d=1800:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${targetW}x${targetH}:fps=30`);
                } else {
                    videoFilters.push(`scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`);
                    videoFilters.push(`crop=${targetW}:${targetH}`);
                }

                // Only add drawtext if font is confirmed available to avoid "No such file" crash
                if (text && fontAvailable) {
                    const cleanText = sanitizeForFFmpeg(text);
                    const fontSize = Math.floor(targetH * 0.045);
                    const boxMargin = Math.floor(targetH * 0.1);
                    
                    // Escaping single quotes in the path for the filter string
                    const escapedFontPath = fontPathFilter.replace(/'/g, "\\'");
                    
                    videoFilters.push(`drawtext=fontfile='${escapedFontPath}':text='${cleanText}':fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.5:boxborderw=20:line_spacing=10:x=(w-text_w)/2:y=h-th-${boxMargin}`);
                }

                videoFilters.push(`format=yuv420p`);
                videoFilters.push(`fps=30`);
                videoFilters.push(`setsar=1`);

                const audioFilters = [
                    `aresample=44100`,
                    `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo`,
                    `volume=1.2`
                ];

                cmd.complexFilter([
                    { filter: videoFilters.join(','), inputs: '0:v', outputs: 'v_out' },
                    { filter: audioFilters.join(','), inputs: '1:a', outputs: 'a_out' }
                ]);

                cmd.map('v_out');
                cmd.map('a_out');

                if (isImage) {
                    if (audio) {
                        cmd.outputOptions(['-shortest']);
                    } else {
                        cmd.duration(5);
                    }
                } else {
                    cmd.outputOptions(['-shortest']);
                }

                cmd.outputOptions([
                    '-c:v libx264', '-preset ultrafast', '-crf 23', '-y',
                    '-c:a aac', '-b:a 192k',
                    '-movflags +faststart'
                ])
                .save(segmentPath)
                .on('end', () => { 
                    segmentPaths.push(segmentPath); 
                    resolve(); 
                })
                .on('error', (err) => {
                    console.error(`❌ Segment ${i} Error:`, err.message);
                    reject(err);
                });
            });
        }

        if (segmentPaths.length === 0) {
            throw new Error("No segments were successfully rendered.");
        }

        // --- CONCATENATION ---
        const finalCmd = ffmpeg();
        
        const validPaths = segmentPaths.filter(p => fs.existsSync(p));
        validPaths.forEach(p => finalCmd.input(p));
        
        const inputs = validPaths.map((_, i) => `[${i}:v][${i}:a]`).join('');
        const filterStr = `${inputs}concat=n=${validPaths.length}:v=1:a=1[v][a]`;

        finalCmd.complexFilter(filterStr)
            .map('[v]').map('[a]')
            .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-c:a aac', '-shortest', '-y'])
            .save(outputPath)
            .on('end', () => {
                try {
                    segmentPaths.forEach(p => fs.unlink(p, () => {}));
                    visualFiles.forEach(f => fs.unlink(f.path, () => {}));
                    audioFiles.forEach(f => fs.unlink(f.path, () => {}));
                } catch(e) {}
                
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` });
            })
            .on('error', (err) => {
                console.error("❌ Master Concat Error:", err.message);
                res.status(500).send(`Render Finalization Error: ${err.message}`);
            });

    } catch (error) {
        console.error("❌ Pipeline Error:", error.message);
        res.status(500).send(`Export Error: ${error.message}`);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
