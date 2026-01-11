
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
    console.log(`✅ FFmpeg Pro Engine v3.2 Active.`);
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
 * Escapes text for drawtext filter with extreme robustness.
 */
function sanitizeForFFmpeg(text) {
    if (!text || text.trim() === '') return ' ';
    // FFmpeg drawtext requires triple/quadruple escaping for some characters in complex filters
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
 * IA TURBO / MASTER RENDER V3.2
 */
app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];

    if (!visualFiles || visualFiles.length === 0) return res.status(400).send('No visuals provided.');

    const resolution = req.body.resolution || '1080p';
    const isVertical = req.body.aspectRatio === '9:16';
    
    let targetW = isVertical ? 1080 : (resolution === '4K' ? 3840 : 1920);
    let targetH = isVertical ? 1920 : (resolution === '4K' ? 2160 : 1080);

    // Strict requirements for libx264: even dimensions
    targetW = Math.floor(targetW / 2) * 2;
    targetH = Math.floor(targetH / 2) * 2;

    const outputFilename = `master_export_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    try {
        const segmentPaths = [];
        
        for (let i = 0; i < visualFiles.length; i++) {
            const visual = visualFiles[i];
            const narrationAudio = audioFiles[i] || null;
            const textLegend = narrations[i] || '';
            const segmentPath = path.join(UPLOAD_DIR, `seg_final_${i}_${Date.now()}.mp4`);
            const isImage = visual.mimetype.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(visual.path);
            
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();

                // Input 0: Visual
                if (isImage) {
                    cmd.input(visual.path).inputOptions(['-loop 1']);
                } else {
                    cmd.input(visual.path);
                }

                // Input 1: Audio logic
                // If narration audio provided, use it. 
                // If not, and it's a video, use the video's own audio.
                // Otherwise, use silence.
                if (narrationAudio) {
                    cmd.input(narrationAudio.path);
                } else if (!isImage) {
                    // Try to re-use input 0 audio
                    cmd.input(visual.path); 
                } else {
                    cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi');
                }

                let videoFilters = [];

                if (isImage) {
                    const aspect = targetW / targetH;
                    let baseW = 3840;
                    let baseH = Math.floor(3840 / aspect);
                    if (aspect < 1) { baseW = Math.floor(3840 * aspect); baseH = 3840; }
                    
                    baseW = Math.floor(baseW / 2) * 2;
                    baseH = Math.floor(baseH / 2) * 2;

                    videoFilters.push(
                        `scale=${baseW}:${baseH}:force_original_aspect_ratio=increase`,
                        `crop=${baseW}:${baseH}`,
                        `setsar=1/1`,
                        // Zoompan with integer coordinates (trunc)
                        `zoompan=z='min(zoom+0.0012,1.5)':x='trunc(iw/2-(iw/zoom/2))':y='trunc(ih/2-(ih/zoom/2))':s=${targetW}x${targetH}:d=1:fps=30`
                    );
                } else {
                    videoFilters.push(
                        `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`,
                        `crop=${targetW}:${targetH}`,
                        `setsar=1/1`
                    );
                }

                // Subtitles (Legendas)
                if (textLegend && textLegend.trim() !== '') {
                    const cleanText = sanitizeForFFmpeg(textLegend);
                    const fontSize = Math.floor(targetH * 0.045);
                    const boxMargin = Math.floor(targetH * 0.15);
                    
                    // Fallback font detection
                    const fonts = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", "arialbd.ttf"];
                    let fontFile = "";
                    for (const f of fonts) if (fs.existsSync(f)) { fontFile = `:fontfile='${f}'`; break; }

                    videoFilters.push(`drawtext=text='${cleanText}'${fontFile}:fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.6:boxborderw=15:x=(w-text_w)/2:y=h-th-${boxMargin}`);
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

                // Segment time limit
                if (isImage) cmd.duration(5);

                cmd.outputOptions([
                    '-c:v libx264',
                    '-preset medium',
                    '-crf 23',
                    '-c:a aac',
                    '-b:a 128k',
                    '-shortest'
                ])
                .save(segmentPath)
                .on('end', () => { segmentPaths.push(segmentPath); resolve(); })
                .on('error', (err) => { 
                    console.error(`❌ Segment ${i} render failed:`, err.message);
                    reject(err); 
                });
            });
        }

        // --- CONCATENATE ALL SEGMENTS ---
        if (segmentPaths.length === 0) throw new Error("No segments were successfully rendered.");

        const finalCmd = ffmpeg();
        segmentPaths.forEach(p => finalCmd.input(p));
        
        const inputs = segmentPaths.map((_, i) => `[${i}:v][${i}:a]`).join('');
        const filterStr = `${inputs}concat=n=${segmentPaths.length}:v=1:a=1[v][a]`;

        finalCmd.complexFilter(filterStr)
            .map('[v]').map('[a]')
            .outputOptions([
                '-c:v libx264',
                '-pix_fmt yuv420p',
                '-c:a aac',
                '-shortest',
                '-movflags +faststart'
            ])
            .save(outputPath)
            .on('end', () => {
                segmentPaths.forEach(p => fs.unlink(p, () => {}));
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` });
            })
            .on('error', (err) => {
                console.error("❌ Concat failure:", err.message);
                res.status(500).send(`Render Error: ${err.message}`);
            });

    } catch (error) {
        console.error("❌ Critical Render Failure:", error.message);
        res.status(500).send(`Export Error: ${error.message}`);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Master Render Engine v3.2 Active on port ${PORT}`));
