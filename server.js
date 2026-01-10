
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
const FONT_URL = "https://github.com/google/fonts/raw/main/apache/roboto/Roboto-Bold.ttf";

const downloadFont = async () => {
    const tempPath = path.join(__dirname, `${FONT_FILENAME}.tmp`);
    
    // Check if valid font exists
    if (fs.existsSync(FONT_PATH) && fs.statSync(FONT_PATH).size > 1000) {
        console.log("✅ Font verified.");
        return;
    }

    console.log("⬇️ Downloading font...");
    const file = fs.createWriteStream(tempPath);
    
    return new Promise((resolve, reject) => {
        https.get(FONT_URL, response => {
            if (response.statusCode !== 200) {
                fs.unlink(tempPath, () => {});
                console.error(`❌ Font download failed: ${response.statusCode}`);
                return resolve(); // Resolve to allow server start
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    try {
                        if (fs.existsSync(FONT_PATH)) fs.unlinkSync(FONT_PATH);
                        fs.renameSync(tempPath, FONT_PATH);
                        console.log("✅ Font installed.");
                    } catch (e) {
                        console.error("❌ Font install error:", e);
                    }
                    resolve();
                });
            });
        }).on('error', err => {
            fs.unlink(tempPath, () => {});
            console.error("❌ Font network error:", err.message);
            resolve();
        });
    });
};
// Trigger download on start
downloadFont();

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
    // Sanitize filename to prevent FFmpeg path issues
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
    
    // Resolution Constants
    const targetW = isVertical ? 1080 : (resolution === '4K' ? 3840 : 1920);
    const targetH = isVertical ? 1920 : (resolution === '4K' ? 2160 : 1080);

    const outputFilename = `master_export_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    // Verify font availability for this request
    const fontAvailable = fs.existsSync(FONT_PATH) && fs.statSync(FONT_PATH).size > 1000;
    const fontPathUnix = FONT_PATH.replace(/\\/g, '/').replace(/:/g, '\\:');

    try {
        const segmentPaths = [];

        for (let i = 0; i < visualFiles.length; i++) {
            const visual = visualFiles[i];
            const audio = audioFiles[i] || null;
            const text = narrations[i] || '';
            const segmentPath = path.join(UPLOAD_DIR, `seg_final_${i}_${Date.now()}.mp4`);
            
            // Check input file existence
            if (!fs.existsSync(visual.path)) {
                console.error(`Missing visual file: ${visual.path}`);
                continue;
            }

            const isImage = visual.mimetype.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(visual.originalname);
            
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();

                // Input 0: Visual
                cmd.input(path.resolve(visual.path)); // Use absolute path
                if (isImage) cmd.inputOptions(['-loop 1']);

                // Input 1: Audio
                if (audio && fs.existsSync(audio.path)) {
                    cmd.input(path.resolve(audio.path));
                } else {
                    cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi');
                }

                // Complex Filter Construction
                let videoFilters = [];
                
                // Optimized Scaling for Stability (Reduced from 4000 to 1.5x target)
                // This prevents "Error initializing complex filters" due to memory on small instances
                const scaleBase = isVertical ? 2880 : 3840; // Approx 1.5x - 2x target

                if (isImage) {
                    // Pre-scale
                    videoFilters.push(`scale=${scaleBase}:${scaleBase}:force_original_aspect_ratio=increase`);
                    videoFilters.push(`crop=${scaleBase}:${scaleBase}`);
                    // Zoompan (Ken Burns)
                    videoFilters.push(`zoompan=z='min(zoom+0.001,1.2)':d=150:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${targetW}x${targetH}`);
                } else {
                    videoFilters.push(`scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`);
                    videoFilters.push(`crop=${targetW}:${targetH}`);
                }

                // Subtitles (Burn-in)
                if (text && fontAvailable) {
                    const cleanText = sanitizeForFFmpeg(text);
                    const fontSize = Math.floor(targetH * 0.045);
                    const boxMargin = Math.floor(targetH * 0.1);
                    
                    videoFilters.push(`drawtext=fontfile='${fontPathUnix}':text='${cleanText}':fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.5:boxborderw=20:line_spacing=10:x=(w-text_w)/2:y=h-th-${boxMargin}`);
                }

                videoFilters.push(`format=yuv420p`);
                videoFilters.push(`fps=30`);

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

                // Duration Logic
                if (isImage) {
                    // If audio exists, match audio duration. If not, default to 5s.
                    // Note: zoompan d=150 @30fps = 5s. 
                    // To support longer audio, we rely on -shortest cutting the visual or audio stream.
                    // But if audio is longer than 5s, zoompan loops or holds last frame? Zoompan usually loops if not careful.
                    // We set d=150 (5s). If audio > 5s, visual might freeze or loop.
                    // For Turbo mode, we accept 5s visual loop for now or depend on zoompan holding.
                    // Best compat:
                    if (audio) {
                        cmd.outputOptions(['-shortest']);
                    } else {
                        cmd.duration(5);
                    }
                } else {
                    cmd.outputOptions(['-shortest']);
                }

                cmd.outputOptions([
                    '-c:v libx264', '-preset ultrafast', '-crf 23', // Faster encoding
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
                    // Do not reject whole process, try to continue with other segments?
                    // But concatenation will fail if a file is missing.
                    // Rejecting is safer for now.
                    reject(err);
                });
            });
        }

        if (segmentPaths.length === 0) {
            throw new Error("No segments were successfully rendered.");
        }

        // --- CONCATENATION ---
        const finalCmd = ffmpeg();
        segmentPaths.forEach(p => finalCmd.input(p));
        
        const inputs = segmentPaths.map((_, i) => `[${i}:v][${i}:a]`).join('');
        const filterStr = `${inputs}concat=n=${segmentPaths.length}:v=1:a=1[v][a]`;

        finalCmd.complexFilter(filterStr)
            .map('[v]').map('[a]')
            .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-c:a aac', '-shortest'])
            .save(outputPath)
            .on('end', () => {
                // Cleanup
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
