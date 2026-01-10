
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

// --- FFMPEG CONFIGURATION ---
try {
    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    const ffprobePath = require('@ffprobe-installer/ffprobe').path;
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
    console.log(`✅ FFmpeg successfully configured at: ${ffmpegPath}`);
} catch (error) {
    console.warn("⚠️ Warning: FFmpeg installers not found, relying on system environment PATH.");
}

const app = express();
const PORT = 8080;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use('/outputs', express.static(OUTPUT_DIR));

// Logging Middleware for debugging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Incoming Request: ${req.method} ${req.url}`);
    next();
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
  }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 500 * 1024 * 1024 } 
});

const getBaseOutputOptions = () => [
    '-c:v libx264',
    '-preset fast',
    '-crf 23',
    '-pix_fmt yuv420p',
    '-c:a aac',
    '-b:a 128k',
    '-ar 44100',
    '-ac 2'
];

// Health check
app.get('/', (req, res) => res.send('AI Media Backend: Active and Ready 🚀'));

// IA Turbo / Master Render
app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    console.log("🚀 Starting IA Turbo mastering process...");
    const visualFiles = req.files['visuals'];
    const audioFiles = req.files['audios'] || [];

    if (!visualFiles || visualFiles.length === 0) {
        console.error("❌ Error: No visual files provided.");
        return res.status(400).send('Visual files required.');
    }

    const resolution = req.body.resolution || '1080p';
    const resScale = resolution === '4K' ? '3840:2160' : '1920:1080';
    const outputFilename = `master_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    const segmentPaths = [];

    try {
        for (let i = 0; i < visualFiles.length; i++) {
            const visual = visualFiles[i];
            const audio = audioFiles[i] || null;
            const segmentPath = path.join(UPLOAD_DIR, `seg_${i}_${Date.now()}.mp4`);
            const isImage = visual.mimetype.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(visual.path);
            
            console.log(`🎬 Processing Segment ${i+1}/${visualFiles.length} (${isImage ? 'Image' : 'Video'})`);

            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();
                if (isImage) {
                    cmd.input(visual.path).inputOptions(['-loop 1']);
                    if (audio) {
                        cmd.input(audio.path);
                    } else {
                        cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi');
                    }
                    cmd.duration(5);
                } else {
                    cmd.input(visual.path);
                    if (audio) cmd.input(audio.path);
                }

                cmd.videoFilter([`scale=${resScale}:force_original_aspect_ratio=decrease,pad=${resScale}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`]);
                cmd.outputOptions([...getBaseOutputOptions(), '-shortest'])
                   .save(segmentPath)
                   .on('end', () => { segmentPaths.push(segmentPath); resolve(); })
                   .on('error', (err) => {
                       console.error(`❌ FFmpeg Segment Error: ${err.message}`);
                       reject(err);
                   });
            });
        }

        console.log("🔗 Concatenating segments...");
        const finalCmd = ffmpeg();
        segmentPaths.forEach(p => finalCmd.input(p));
        const filterStr = segmentPaths.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${segmentPaths.length}:v=1:a=1[v][a]`;

        finalCmd.complexFilter(filterStr)
            .map('[v]').map('[a]')
            .outputOptions(getBaseOutputOptions())
            .save(outputPath)
            .on('end', () => {
                console.log(`✅ Rendering successful: ${outputFilename}`);
                segmentPaths.forEach(p => fs.unlink(p, () => {}));
                // Return a relative path that works through the proxy
                res.json({ url: `/api/outputs/${outputFilename}` });
            })
            .on('error', (err) => {
                console.error(`❌ Final Render Error: ${err.message}`);
                res.status(500).send(err.message);
            });

    } catch (error) {
        console.error(`❌ IA Turbo Failed: ${error.message}`);
        res.status(500).send(error.message);
    }
});

// Generic Processor Route Handler
const handleGeneric = (cmd, req, res, outName) => {
    const outputPath = path.join(OUTPUT_DIR, outName);
    cmd.outputOptions(getBaseOutputOptions())
       .save(outputPath)
       .on('end', () => {
           console.log(`✅ Processed: ${outName}`);
           res.json({ url: `/api/outputs/${outName}` });
       })
       .on('error', (err) => {
           console.error(`❌ Processing Error: ${err.message}`);
           res.status(500).send(err.message);
       });
};

app.post('/upscale', upload.array('video'), (req, res) => {
    const cmd = ffmpeg(req.files[0].path).videoFilter('scale=3840:2160:flags=lanczos');
    handleGeneric(cmd, req, res, `upscale_${Date.now()}.mp4`);
});

app.post('/colorize', upload.array('video'), (req, res) => {
    const cmd = ffmpeg(req.files[0].path).videoFilter('eq=saturation=1.5:contrast=1.2');
    handleGeneric(cmd, req, res, `color_${Date.now()}.mp4`);
});

app.post('/compress', upload.array('video'), (req, res) => {
    const cmd = ffmpeg(req.files[0].path).outputOptions(['-crf', '28']);
    handleGeneric(cmd, req, res, `comp_${Date.now()}.mp4`);
});

app.post('/shuffle', upload.array('video'), (req, res) => {
    const cmd = ffmpeg(req.files[0].path).videoFilter('noise=alls=20:allf=t+u');
    handleGeneric(cmd, req, res, `glitch_${Date.now()}.mp4`);
});

app.post('/cut', upload.array('video'), (req, res) => {
    const cmd = ffmpeg(req.files[0].path).setStartTime(req.body.startTime || 0).duration(req.body.duration || 10);
    handleGeneric(cmd, req, res, `cut_${Date.now()}.mp4`);
});

app.post('/join', upload.array('video'), (req, res) => {
    const outName = `join_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outName);
    const cmd = ffmpeg(req.files[0].path);
    req.files.slice(1).forEach(f => cmd.input(f.path));
    cmd.mergeToFile(outputPath, UPLOAD_DIR)
       .on('end', () => res.json({ url: `/api/outputs/${outName}` }))
       .on('error', (err) => res.status(500).send(err.message));
});

app.post('/remove-audio', upload.array('video'), (req, res) => {
    const cmd = ffmpeg(req.files[0].path).noAudio();
    handleGeneric(cmd, req, res, `mute_${Date.now()}.mp4`);
});

app.post('/extract-audio', upload.array('video'), (req, res) => {
    const outName = `audio_${Date.now()}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, outName);
    ffmpeg(req.files[0].path).noVideo().save(outputPath)
       .on('end', () => res.json({ url: `/api/outputs/${outName}` }))
       .on('error', (err) => res.status(500).send(err.message));
});

app.post('/process-audio', upload.array('audio'), (req, res) => {
    const outName = `audio_proc_${Date.now()}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, outName);
    ffmpeg(req.files[0].path).save(outputPath)
       .on('end', () => res.json({ url: `/api/outputs/${outName}` }))
       .on('error', (err) => res.status(500).send(err.message));
});

app.post('/process-image', upload.array('image'), (req, res) => {
    const outName = `img_proc_${Date.now()}.png`;
    const outputPath = path.join(OUTPUT_DIR, outName);
    ffmpeg(req.files[0].path).save(outputPath)
       .on('end', () => res.json({ url: `/api/outputs/${outName}` }))
       .on('error', (err) => res.status(500).send(err.message));
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Rendering Engine listening on port ${PORT}`));
