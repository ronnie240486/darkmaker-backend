
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
 * Essential to avoid "Invalid argument" when text contains special characters
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
 * Fixed complex filters to prevent "Invalid argument" and stream mismatch errors.
 */
app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];

    if (!visualFiles || visualFiles.length === 0) return res.status(400).send('Visual files required.');

    const resolution = req.body.resolution || '1080p';
    const resWidth = resolution === '4K' ? 3840 : (req.body.aspectRatio === '9:16' ? 608 : 1920);
    const resHeight = resolution === '4K' ? 2160 : (req.body.aspectRatio === '9:16' ? 1080 : 1080);
    
    // Adjusting for vertical if needed (standardized)
    const finalW = req.body.aspectRatio === '9:16' ? 1080 : resWidth;
    const finalH = req.body.aspectRatio === '9:16' ? 1920 : resHeight;

    const outputFilename = `final_master_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    try {
        const segmentPaths = [];
        
        for (let i = 0; i < visualFiles.length; i++) {
            const visual = visualFiles[i];
            const audio = audioFiles[i] || null;
            const narration = narrations[i] || '';
            const segmentPath = path.join(UPLOAD_DIR, `master_seg_${i}_${Date.now()}.mp4`);
            const isImage = visual.mimetype.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(visual.path);
            
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();

                // Input 0: Visual
                if (isImage) {
                    cmd.input(visual.path).inputOptions(['-loop 1']);
                } else {
                    cmd.input(visual.path);
                }

                // Input 1: Audio (Real or Null)
                if (audio) {
                    cmd.input(audio.path);
                } else {
                    cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi');
                }

                // Strictly defined video filter chain
                // 1. Scale/Crop to a working size (zoompan is sensitive)
                // 2. Apply movement (if image)
                // 3. Draw text (subtitle)
                // 4. Final format/fps normalization
                let vFilter = [
                    `scale=2000:-1`, // Scale up slightly for better zoom quality
                    `pad=2000:2000:(ow-iw)/2:(oh-ih)/2:black`, // Pad to square to avoid aspect issues in zoom
                ];

                if (isImage) {
                    // Ken Burns effect: Subtle zoom in
                    vFilter.push(`zoompan=z='min(zoom+0.001,1.3)':d=150:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${finalW}x${finalH}`);
                } else {
                    vFilter.push(`scale=${finalW}:${finalH}:force_original_aspect_ratio=increase,crop=${finalW}:${finalH}`);
                }

                if (narration) {
                    const safeText = escapeFFmpegText(narration);
                    vFilter.push(`drawtext=text='${safeText}':fontcolor=white:fontsize=44:box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-th-80`);
                }

                vFilter.push(`format=yuv420p`, `fps=30`, `setsar=1`);

                const aFilter = [
                    `aresample=44100`,
                    `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo`
                ];

                cmd.complexFilter([
                    { filter: vFilter.join(','), inputs: '0:v', outputs: 'vproc' },
                    { filter: aFilter.join(','), inputs: '1:a', outputs: 'aproc' }
                ]);

                cmd.map('vproc').map('aproc');

                if (isImage) {
                    // Set segment duration. If audio exists, it will be trimmed to shortest below.
                    cmd.duration(5); 
                }

                cmd.outputOptions([...getBaseOutputOptions(), '-shortest'])
                   .save(segmentPath)
                   .on('end', () => { segmentPaths.push(segmentPath); resolve(); })
                   .on('error', (err) => { 
                       console.error(`Error in segment ${i}:`, err.message); 
                       reject(err); 
                   });
            });
        }

        // Final Concatenation
        const finalCmd = ffmpeg();
        segmentPaths.forEach(p => finalCmd.input(p));
        
        const filterStr = segmentPaths.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${segmentPaths.length}:v=1:a=1[v][a]`;

        finalCmd.complexFilter(filterStr)
            .map('[v]').map('[a]')
            .outputOptions(getBaseOutputOptions())
            .save(outputPath)
            .on('end', () => {
                segmentPaths.forEach(p => fs.unlink(p, () => {}));
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` });
            })
            .on('error', (err) => {
                console.error("Concat stage error:", err.message);
                res.status(500).send(`Final Render Failed: ${err.message}`);
            });

    } catch (error) {
        console.error("Global processing error:", error.message);
        res.status(500).send(`Export Error: ${error.message}`);
    }
});

// Helper for other video routes
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

app.post('/process-audio', upload.array('audio'), (req, res) => {
    if (!req.files[0]) return res.status(400).send('No audio.');
    const file = req.files[0];
    const out = path.join(OUTPUT_DIR, `audio_${Date.now()}.mp3`);
    ffmpeg(file.path).output(out).on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(out)}` })).run();
});

app.post('/process-image', upload.array('image'), (req, res) => {
    if (!req.files[0]) return res.status(400).send('No image.');
    const file = req.files[0];
    const out = path.join(OUTPUT_DIR, `img_${Date.now()}.png`);
    ffmpeg(file.path).output(out).on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(out)}` })).run();
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Advanced Render Engine on port ${PORT}`));
