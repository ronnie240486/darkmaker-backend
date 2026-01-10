
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

// --- FFmpeg Setup ---
let ffmpegPath, ffprobePath;
try {
    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    ffprobePath = require('@ffprobe-installer/ffprobe').path;
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
} catch (e) { console.error("FFmpeg Load Error:", e); }

const app = express();
const PORT = process.env.PORT || 8080;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use('/outputs', express.static(OUTPUT_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

/**
 * MODO TURBO MASTER: Estável e com Movimento + Legendas
 */
app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visuals = req.files['visuals'];
    const audios = req.files['audios'] || [];
    if (!visuals) return res.status(400).send('No visuals provided');

    const texts = req.body.texts ? JSON.parse(req.body.texts) : [];
    const resolution = req.body.resolution || '1080p';
    const resW = resolution === '4K' ? 3840 : 1920;
    const resH = resolution === '4K' ? 2160 : 1080;
    const fps = 30;
    
    const outputFilename = `master_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    const segmentPaths = [];

    try {
        console.log(`[STABLE RENDER] Processing ${visuals.length} scenes @ ${resW}x${resH}...`);

        for (let i = 0; i < visuals.length; i++) {
            const vFile = visuals[i];
            const aFile = audios[i];
            const segPath = path.join(UPLOAD_DIR, `seg_${i}_${Date.now()}.mp4`);
            const isImg = vFile.mimetype.startsWith('image');
            
            // Critical: Set a long duration buffer (e.g., 60s) for images/zoompan.
            // This ensures the video stream doesn't end before the audio, preventing -shortest from cutting audio early.
            // If audio is missing, we limit to 5s.
            const duration = aFile ? 60 : 5; 

            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();
                
                // INPUTS
                if (isImg) {
                    // Loop image input
                    cmd.input(vFile.path).inputOptions(['-loop 1', `-t ${duration}`]);
                } else {
                    cmd.input(vFile.path);
                }

                // AUDIO INPUT
                if (aFile) {
                    cmd.input(aFile.path);
                } else {
                    cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi').inputOptions([`-t ${duration}`]);
                }

                // FILTERS
                let vFilter = '';
                
                if (isImg) {
                    // KEN BURNS EFFECT (ZOOMPAN)
                    const zoomDuration = duration * fps;
                    vFilter = `scale=-2:${resH*2},zoompan=z='min(zoom+0.0015,1.5)':d=${zoomDuration}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${resW}x${resH}:fps=${fps},setsar=1`;
                } else {
                    // VIDEO FITTING
                    vFilter = `scale=${resW}:${resH}:force_original_aspect_ratio=decrease,pad=${resW}:${resH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`;
                }

                // SUBTITLES (Burning)
                if (texts[i]) {
                    const srtPath = path.join(UPLOAD_DIR, `sub_${i}_${Date.now()}.srt`);
                    // Simple SRT format: 1 subtitle active for the whole segment duration
                    const srtContent = `1\n00:00:00,000 --> 00:02:00,000\n${texts[i]}`; 
                    fs.writeFileSync(srtPath, srtContent);

                    // Path sanitation for FFmpeg
                    const cleanSrtPath = srtPath.replace(/\\/g, '/').replace(':', '\\:');
                    
                    // Add subtitles filter with styling
                    vFilter += `,subtitles='${cleanSrtPath}':force_style='Fontname=Arial,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=1,Shadow=0,Alignment=2,MarginV=30'`;
                }

                // Final pixel format
                vFilter += `,format=yuv420p`;

                cmd.complexFilter([
                    `[0:v]${vFilter}[v]`,
                    `[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a]`
                ])
                .map('[v]').map('[a]')
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-preset ultrafast', 
                    '-crf 28',
                    '-threads 1',
                    '-movflags +faststart',
                    '-pix_fmt yuv420p',
                    '-ac 2',        // Force 2 channels
                    '-ar 44100',    // Force 44.1kHz
                    '-shortest'     // Cut to shortest stream (usually audio, since video is padded to 60s)
                ])
                .save(segPath)
                .on('end', () => { 
                    segmentPaths.push(segPath); 
                    resolve(); 
                })
                .on('error', (err) => {
                    console.error(`Error scene ${i}:`, err.message);
                    reject(err);
                });
            });
        }

        // CONCATENATION
        const listFile = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);
        const listContent = segmentPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(listFile, listContent);

        await new Promise((resolve, reject) => {
            ffmpeg().input(listFile).inputOptions(['-f concat', '-safe 0'])
                .outputOptions(['-c copy', '-threads 1'])
                .save(outputPath)
                .on('end', resolve)
                .on('error', reject);
        });

        // CLEANUP
        try {
            fs.unlink(listFile, () => {});
            segmentPaths.forEach(p => fs.unlink(p, () => {}));
            visuals.forEach(f => fs.unlink(f.path, () => {}));
            audios.forEach(f => fs.unlink(f.path, () => {}));
            // Cleanup SRTs if any
            const srtFiles = fs.readdirSync(UPLOAD_DIR).filter(f => f.startsWith('sub_') && f.endsWith('.srt'));
            srtFiles.forEach(f => fs.unlink(path.join(UPLOAD_DIR, f), () => {}));
        } catch(e) {}

        res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` });

    } catch (err) {
        console.error("Mastering Error:", err);
        res.status(500).send(err.message);
    }
});

app.get('/', (req, res) => res.send('Turbo Engine Active 2.1'));
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on ${PORT}`));
