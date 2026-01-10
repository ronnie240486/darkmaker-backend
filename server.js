
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
    console.log(`✅ FFmpeg robustly configured.`);
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
    cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
  }
});
const upload = multer({ storage: storage });

const getBaseOutputOptions = () => [
    '-c:v libx264',
    '-preset fast',
    '-crf 22',
    '-pix_fmt yuv420p',
    '-c:a aac',
    '-b:a 128k',
    '-ar 44100',
    '-ac 2'
];

/**
 * Escape function for FFmpeg drawtext
 */
function escapeFFmpegText(text) {
    if (!text) return '';
    return text
        .replace(/\\/g, '\\\\\\\\')
        .replace(/'/g, "'\\\\\\''")
        .replace(/:/g, '\\:')
        .replace(/%/g, '\\%');
}

/**
 * IA TURBO / MASTER RENDER
 * Refactored to handle each segment with extreme care to avoid filter re-init errors.
 */
app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];

    if (!visualFiles || visualFiles.length === 0) return res.status(400).send('Visual files required.');

    const resolution = req.body.resolution || '1080p';
    const isVertical = req.body.aspectRatio === '9:16';
    
    // Standard target dimensions
    const finalW = isVertical ? 1080 : (resolution === '4K' ? 3840 : 1920);
    const finalH = isVertical ? 1920 : (resolution === '4K' ? 2160 : 1080);

    const outputFilename = `final_master_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    try {
        const segmentPaths = [];
        
        for (let i = 0; i < visualFiles.length; i++) {
            const visual = visualFiles[i];
            const audio = audioFiles[i] || null;
            const narration = narrations[i] || '';
            const segmentPath = path.join(UPLOAD_DIR, `seg_norm_${i}_${Date.now()}.mp4`);
            const isImage = visual.mimetype.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(visual.path);
            
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();

                // 1. Input Source
                if (isImage) {
                    cmd.input(visual.path).inputOptions(['-loop 1']);
                } else {
                    cmd.input(visual.path);
                }

                // 2. Audio Source
                if (audio) {
                    cmd.input(audio.path);
                } else {
                    cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi');
                }

                // 3. Filter Chain Construction
                // We normalize dimensions BEFORE any movement or text filters
                let vFilter = [];
                
                if (isImage) {
                    // Optimized Zoompan chain for images
                    // First scale to a consistent high resolution to avoid "Invalid argument" in zoompan
                    vFilter.push(`scale=4000:4000:force_original_aspect_ratio=increase`);
                    vFilter.push(`crop=4000:4000`);
                    vFilter.push(`zoompan=z='min(zoom+0.001,1.2)':d=150:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${finalW}x${finalH}`);
                } else {
                    // Video normalization
                    vFilter.push(`scale=${finalW}:${finalH}:force_original_aspect_ratio=increase`);
                    vFilter.push(`crop=${finalW}:${finalH}`);
                }

                // Drawtext Subtitles
                if (narration) {
                    const safeText = escapeFFmpegText(narration);
                    // Dynamically calculate font size based on height
                    const fontSize = Math.floor(finalH * 0.04);
                    vFilter.push(`drawtext=text='${safeText}':fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.5:boxborderw=20:x=(w-text_w)/2:y=h-th-(h*0.1)`);
                }

                // Final frame-by-frame normalization
                vFilter.push(`format=yuv420p`, `fps=30`, `setsar=1`);

                const aFilter = [
                    `aresample=44100`,
                    `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo`
                ];

                cmd.complexFilter([
                    { filter: vFilter.join(','), inputs: '0:v', outputs: 'v_out' },
                    { filter: aFilter.join(','), inputs: '1:a', outputs: 'a_out' }
                ]);

                cmd.map('v_out').map('a_out');

                if (isImage) {
                    cmd.duration(5); // Default 5s per photo
                }

                cmd.outputOptions([...getBaseOutputOptions(), '-shortest'])
                   .save(segmentPath)
                   .on('end', () => { segmentPaths.push(segmentPath); resolve(); })
                   .on('error', (err) => { 
                       console.error(`Segment ${i} Error:`, err.message); 
                       reject(err); 
                   });
            });
        }

        // Final Batch Concatenation
        const finalCmd = ffmpeg();
        segmentPaths.forEach(p => finalCmd.input(p));
        
        const filterStr = segmentPaths.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${segmentPaths.length}:v=1:a=1[v][a]`;

        finalCmd.complexFilter(filterStr)
            .map('[v]').map('[a]')
            .outputOptions(getBaseOutputOptions())
            .save(outputPath)
            .on('end', () => {
                // Cleanup temp segments
                segmentPaths.forEach(p => fs.unlink(p, () => {}));
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` });
            })
            .on('error', (err) => {
                console.error("Master Concat Error:", err.message);
                res.status(500).send(`Final Rendering stage failed: ${err.message}`);
            });

    } catch (error) {
        console.error("Global Turbo Error:", error.message);
        res.status(500).send(`Export Error: ${error.message}`);
    }
});

// Other utility routes
const genericHandler = (route, optionsCallback) => {
    app.post(route, upload.array('video'), async (req, res) => {
        const files = req.files;
        if (!files || files.length === 0) return res.status(400).send('Files required.');
        const outputFilename = `proc_${Date.now()}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        let cmd = ffmpeg(files[0].path);
        if (optionsCallback) optionsCallback(cmd, req);
        cmd.outputOptions(getBaseOutputOptions())
           .save(outputPath)
           .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
           .on('error', (err) => res.status(500).send(err.message));
    });
};

genericHandler('/upscale', (cmd) => cmd.videoFilter('scale=3840:2160:flags=lanczos'));
genericHandler('/colorize', (cmd) => cmd.videoFilter('eq=saturation=1.5:contrast=1.2'));
genericHandler('/compress', (cmd) => cmd.outputOptions(['-crf', '28', '-preset', 'slow']));
genericHandler('/shuffle', (cmd) => cmd.videoFilter('noise=alls=20:allf=t+u'));
genericHandler('/remove-audio', (cmd) => cmd.noAudio());

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Final Stable Render Engine on port ${PORT}`));
