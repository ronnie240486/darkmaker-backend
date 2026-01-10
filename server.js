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

// Helper: Standard Output Options for Final Render
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
 * IA TURBO / MASTER RENDER
 * Robust concatenation with strictly normalized segments
 */
app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'];
    const audioFiles = req.files['audios'] || [];

    if (!visualFiles || visualFiles.length === 0) return res.status(400).send('Visual files required.');

    const format = req.body.format || 'mp4';
    const resolution = req.body.resolution || '1080p';
    const resWidth = resolution === '4K' ? 3840 : 1920;
    const resHeight = resolution === '4K' ? 2160 : 1080;
    const outputFilename = `master_render_${Date.now()}.${format}`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    try {
        const segmentPaths = [];
        
        for (let i = 0; i < visualFiles.length; i++) {
            const visual = visualFiles[i];
            const audio = audioFiles[i] || null;
            const segmentPath = path.join(UPLOAD_DIR, `seg_${i}_${Date.now()}.mp4`);
            const isImage = visual.mimetype.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(visual.path);
            
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();

                if (isImage) {
                    cmd.input(visual.path).inputOptions(['-loop 1']);
                } else {
                    cmd.input(visual.path);
                }

                if (audio) {
                    cmd.input(audio.path);
                } else {
                    // Generate silent audio for segments without narration
                    cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi');
                }

                // Complex filters to ensure absolute normalization
                const videoFilters = [
                    `scale=${resWidth}:${resHeight}:force_original_aspect_ratio=increase`,
                    `crop=${resWidth}:${resHeight}`,
                    `setsar=1`,
                    `format=yuv420p`,
                    `fps=30`
                ];

                const audioFilters = [
                    `aresample=44100`,
                    `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo`
                ];

                cmd.complexFilter([
                    { filter: videoFilters.join(','), inputs: '0:v', outputs: 'v_norm' },
                    { filter: audioFilters.join(','), inputs: '1:a', outputs: 'a_norm' }
                ]);

                cmd.map('v_norm').map('a_norm');

                if (isImage) {
                    // Default to 5s if no audio, or use audio duration
                    if (!audio) cmd.duration(5);
                }

                cmd.outputOptions([...getBaseOutputOptions(), '-shortest'])
                   .save(segmentPath)
                   .on('start', (commandLine) => {
                       console.log(`Processing segment ${i}: ${commandLine}`);
                   })
                   .on('end', () => { 
                       segmentPaths.push(segmentPath); 
                       resolve(); 
                   })
                   .on('error', (err) => { 
                       console.error(`Segment ${i} Error:`, err); 
                       reject(err); 
                   });
            });
        }

        if (segmentPaths.length === 0) {
            throw new Error("No segments were successfully rendered.");
        }

        // Final Merge using Concat Filter
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
                console.error("Final Merge Error:", err);
                res.status(500).send(`Final rendering stage failed: ${err.message}`);
            });

    } catch (error) {
        console.error("Global Export Error:", error);
        res.status(500).send(`Export Error: ${error.message}`);
    }
});

/**
 * GENERIC PROCESSING ROUTES
 */
const genericHandler = (route, optionsCallback) => {
    app.post(route, upload.array('video'), async (req, res) => {
        const files = req.files;
        if (!files || files.length === 0) return res.status(400).send('Files required.');
        
        const outputFilename = `proc_${Date.now()}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        let cmd = ffmpeg(files[0].path);

        if (route === '/join' && files.length > 1) {
            files.slice(1).forEach(f => cmd.input(f.path));
            cmd.mergeToFile(outputPath, UPLOAD_DIR);
        } else {
            if (optionsCallback) optionsCallback(cmd, req);
            cmd.outputOptions(getBaseOutputOptions())
               .save(outputPath)
               .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
               .on('error', (err) => res.status(500).send(err.message));
        }
    });
};

genericHandler('/upscale', (cmd) => cmd.videoFilter('scale=3840:2160:flags=lanczos'));
genericHandler('/colorize', (cmd) => cmd.videoFilter('eq=saturation=1.5:contrast=1.2'));
genericHandler('/compress', (cmd) => cmd.outputOptions(['-crf', '28', '-preset', 'slow']));
genericHandler('/shuffle', (cmd) => cmd.videoFilter('noise=alls=20:allf=t+u'));
genericHandler('/cut', (cmd, req) => cmd.setStartTime(req.body.startTime || 0).duration(req.body.duration || 10));
genericHandler('/join', null);
genericHandler('/remove-audio', (cmd) => cmd.noAudio());
genericHandler('/extract-audio', (cmd, res) => {
    const out = path.join(OUTPUT_DIR, `audio_${Date.now()}.mp3`);
    cmd.output(out).noVideo().on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(out)}` }));
});

app.post('/process-audio', upload.array('audio'), (req, res) => {
    if (!req.files[0]) return res.status(400).send('No audio file provided.');
    const file = req.files[0];
    const outputFilename = `audio_proc_${Date.now()}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    
    ffmpeg(file.path)
        .output(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message))
        .run();
});

app.post('/process-image', upload.array('image'), (req, res) => {
    if (!req.files[0]) return res.status(400).send('No image file provided.');
    const file = req.files[0];
    const outputFilename = `img_proc_${Date.now()}.png`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    
    ffmpeg(file.path)
        .output(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message))
        .run();
});

app.get('/', (req, res) => res.send('AI Media Backend Active. 🚀'));

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Rendering Engine on port ${PORT}`));
