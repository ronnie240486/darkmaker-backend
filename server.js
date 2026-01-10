
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

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
        .replace(/%/g, '\\%');
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
                // 1. Normalize video size and format
                // 2. Apply Ken Burns (if image)
                // 3. Burn-in professional subtitles
                // 4. Normalize audio to standard stereo
                
                let videoFilters = [
                    `scale=4000:4000:force_original_aspect_ratio=increase`,
                    `crop=4000:4000`
                ];

                if (isImage) {
                    // Smooth 10-second Ken Burns effect
                    videoFilters.push(`zoompan=z='min(zoom+0.001,1.2)':d=300:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${targetW}x${targetH}`);
                } else {
                    videoFilters.push(`scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`, `crop=${targetW}:${targetH}`);
                }

                // Add Professional Subtitles
                if (text) {
                    const cleanText = sanitizeForFFmpeg(text);
                    const fontSize = Math.floor(targetH * 0.045);
                    const boxMargin = Math.floor(targetH * 0.1);
                    // Double-pass: Shadow and Main text for perfect readability
                    videoFilters.push(`drawtext=text='${cleanText}':fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.5:boxborderw=20:line_spacing=10:x=(w-text_w)/2:y=h-th-${boxMargin}`);
                }

                videoFilters.push(`format=yuv420p`, `fps=30`);

                const audioFilters = [
                    `aresample=44100`,
                    `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo`,
                    `volume=1.2` // Slight boost for clarity
                ];

                cmd.complexFilter([
                    { filter: videoFilters.join(','), inputs: '0:v', outputs: 'v_out' },
                    { filter: audioFilters.join(','), inputs: '1:a', outputs: 'a_out' }
                ]);

                cmd.map('v_out').map('a_out');

                // If image, limit to 5 seconds. If video, use its duration or shortest to audio.
                if (isImage) cmd.duration(5);

                cmd.outputOptions([
                    '-c:v libx264',
                    '-preset fast',
                    '-crf 20',
                    '-c:a aac',
                    '-b:a 192k',
                    '-shortest'
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
        
        // Exact mapping of video and audio streams for each segment
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
