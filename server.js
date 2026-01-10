
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

// --- FONT CONFIGURATION ---
const FONT_PATH = path.join(__dirname, 'Roboto-Bold.ttf');
const FONT_URL = "https://github.com/google/fonts/raw/main/apache/roboto/Roboto-Bold.ttf";

function ensureFontExists() {
    if (!fs.existsSync(FONT_PATH)) {
        console.log("Downloading default font for subtitles...");
        const file = fs.createWriteStream(FONT_PATH);
        https.get(FONT_URL, function(response) {
            response.pipe(file);
            file.on('finish', function() {
                file.close(() => console.log("✅ Font downloaded successfully."));
            });
        }).on('error', function(err) {
            fs.unlink(FONT_PATH, () => {}); // Delete the file async if error
            console.error("❌ Error downloading font:", err.message);
        });
    }
}
ensureFontExists();

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
    cb(null, `raw_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`);
  }
});
const upload = multer({ storage: storage });

/**
 * Escapes text for drawtext filter. 
 * Prevents "Invalid Argument" crashes caused by commas, colons or quotes.
 */
function sanitizeForFFmpeg(text) {
    if (!text) return '';
    return text
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "'\\\\''")
        .replace(/:/g, '\\:')
        .replace(/,/g, '\\,')
        .replace(/%/g, '\\%')
        .replace(/\n/g, ' ') // Flatten newlines to avoid complex filter parsing issues
        .replace(/\r/g, '');
}

/**
 * IA TURBO / MASTER RENDER V3
 * High-performance rendering pipeline with burn-in subtitles and synchronized audio.
 */
app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];

    if (!visualFiles || visualFiles.length === 0) return res.status(400).send('No visuals provided.');

    const resolution = req.body.resolution || '1080p';
    const isVertical = req.body.aspectRatio === '9:16';
    
    // Professional resolution standards
    const targetW = isVertical ? 1080 : (resolution === '4K' ? 3840 : 1920);
    const targetH = isVertical ? 1920 : (resolution === '4K' ? 2160 : 1080);

    const outputFilename = `master_export_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    try {
        const segmentPaths = [];
        
        // Ensure font is ready (synchronous check fallback if download failed previously)
        const fontPathUnix = FONT_PATH.replace(/\\/g, '/').replace(/:/g, '\\:');

        for (let i = 0; i < visualFiles.length; i++) {
            const visual = visualFiles[i];
            const audio = audioFiles[i] || null;
            const text = narrations[i] || '';
            const segmentPath = path.join(UPLOAD_DIR, `seg_final_${i}_${Date.now()}.mp4`);
            const isImage = visual.mimetype.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(visual.path);
            
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();

                // Input 0: The Visual (Image or Video)
                if (isImage) {
                    cmd.input(visual.path).inputOptions(['-loop 1']);
                } else {
                    cmd.input(visual.path);
                }

                // Input 1: The Audio (Narration or Silence)
                if (audio) {
                    cmd.input(audio.path);
                } else {
                    // Generate internal high-quality silence to keep audio stream alive for merge
                    cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi');
                }

                // --- COMPLEX FILTER GRAPH ---
                let videoFilters = [];

                if (isImage) {
                    // Pre-scale images to a high base before zoompan to maintain quality
                    videoFilters.push(`scale=4000:4000:force_original_aspect_ratio=increase`, `crop=4000:4000`);
                    // Smooth 5-second Ken Burns effect
                    videoFilters.push(`zoompan=z='min(zoom+0.001,1.2)':d=150:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${targetW}x${targetH}`);
                } else {
                    videoFilters.push(`scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`, `crop=${targetW}:${targetH}`);
                }

                // Add Professional Subtitles
                if (text && fs.existsSync(FONT_PATH)) {
                    const cleanText = sanitizeForFFmpeg(text);
                    const fontSize = Math.floor(targetH * 0.045);
                    const boxMargin = Math.floor(targetH * 0.1);
                    
                    // Uses fontfile parameter to explicitly point to the downloaded font
                    videoFilters.push(`drawtext=fontfile='${fontPathUnix}':text='${cleanText}':fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.5:boxborderw=20:line_spacing=10:x=(w-text_w)/2:y=h-th-${boxMargin}`);
                } else if (text) {
                    console.warn("⚠️ Warning: Skipping subtitles for segment " + i + " because font file is missing.");
                }

                videoFilters.push(`format=yuv420p`, `fps=30`);

                const audioFilters = [
                    `aresample=44100`,
                    `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo`,
                    `volume=1.2` 
                ];

                cmd.complexFilter([
                    { filter: videoFilters.join(','), inputs: '0:v', outputs: 'v_out' },
                    { filter: audioFilters.join(','), inputs: '1:a', outputs: 'a_out' }
                ]);

                cmd.map('v_out').map('a_out');

                // Critical: Explicitly set duration for image inputs based on audio or default
                if (isImage) {
                    // We don't know exact audio duration here without probing, so we rely on -shortest if audio exists.
                    // However, zoompan duration (d=150 @ 30fps = 5s) determines video stream length.
                    // To be safe, we set a high -t if audio is present, or 5s if not.
                    if (audio) {
                         // Let -shortest handle the cut when audio ends
                         cmd.outputOptions(['-shortest']);
                    } else {
                         cmd.duration(5);
                    }
                } else {
                    cmd.outputOptions(['-shortest']);
                }

                cmd.outputOptions([
                    '-c:v libx264',
                    '-preset fast',
                    '-crf 20',
                    '-c:a aac',
                    '-b:a 192k',
                    '-movflags +faststart'
                ])
                .save(segmentPath)
                .on('end', () => { segmentPaths.push(segmentPath); resolve(); })
                .on('error', (err) => { 
                    console.error(`Segment ${i} Logic Error:`, err.message);
                    reject(err); 
                });
            });
        }

        // --- FINAL CONCATENATION ---
        const finalCmd = ffmpeg();
        segmentPaths.forEach(p => finalCmd.input(p));
        
        const inputs = segmentPaths.map((_, i) => `[${i}:v][${i}:a]`).join('');
        const filterStr = `${inputs}concat=n=${segmentPaths.length}:v=1:a=1[v][a]`;

        finalCmd.complexFilter(filterStr)
            .map('[v]').map('[a]')
            .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-c:a aac', '-shortest'])
            .save(outputPath)
            .on('start', cmd => console.log('Merge Started:', cmd))
            .on('end', () => {
                // Background cleanup
                segmentPaths.forEach(p => fs.unlink(p, () => {}));
                visualFiles.forEach(f => fs.unlink(f.path, () => {}));
                audioFiles.forEach(f => fs.unlink(f.path, () => {}));
                
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` });
            })
            .on('error', (err) => {
                console.error("Master Concat Failure:", err.message);
                res.status(500).send(`Render Finalization Error: ${err.message}`);
            });

    } catch (error) {
        console.error("Turbo Pipeline Critical Failure:", error.message);
        res.status(500).send(`Export Error: ${error.message}`);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Pro Render Engine Active on port ${PORT}`));
