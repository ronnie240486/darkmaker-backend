import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

// ================== FIX ESM ==================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================== FFMPEG ==================
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);
console.log('✅ FFmpeg carregado');

// ================== APP ==================
const app = express();
const PORT = process.env.PORT || 8080;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ================== MIDDLEWARE ==================
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(OUTPUT_DIR));

// ================== MULTER ==================
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) =>
    cb(null, `media_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

// ================== UTIL ==================
const escapeForDrawtext = text =>
  text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, '\\\\:');

// ================== PROCESS SCENE ==================
const processScene = async (
  visual,
  audio,
  text,
  index,
  w,
  h,
  isImg
) => {
  const segPath = path.join(UPLOAD_DIR, `seg_${index}_${Date.now()}.mp4`);

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();

    // ---- VIDEO INPUT ----
    if (isImg) {
      cmd.input(visual.path).inputOptions(['-loop 1']);
    } else {
      cmd.input(visual.path);
    }

    // ---- AUDIO INPUT ----
    if (audio && fs.existsSync(audio.path)) {
      cmd.input(audio.path);
    } else {
      cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100')
        .inputFormat('lavfi');
    }

    const vFilters = [
      `scale=${w}:${h}:force_original_aspect_ratio=increase`,
      `crop=${w}:${h}`,
      `setsar=1/1`
    ];

    if (isImg) {
      vFilters.push(
        `zoompan=z='min(zoom+0.001,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:d=1`
      );
    }

    if (text?.trim()) {
      vFilters.push(
        `drawtext=text='${escapeForDrawtext(text)}':fontcolor=white:fontsize=h/18:box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-(text_h*2)`
      );
    }

    vFilters.push(
      'fade=t=in:st=0:d=0.5',
      'fade=t=out:st=9.5:d=0.5',
      'format=yuv420p',
      'fps=30'
    );

    const aFilters = [
      'aresample=44100',
      'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
      'volume=1.2',
      'afade=t=in:st=0:d=0.3',
      'afade=t=out:st=9.7:d=0.3'
    ];

    cmd.complexFilter([
      { filter: vFilters.join(','), inputs: '0:v', outputs: 'v' },
      { filter: aFilters.join(','), inputs: '1:a', outputs: 'a' }
    ]);

    cmd
      .map('v')
      .map('a')
      .outputOptions([
        '-t 10',
        '-shortest',
        '-c:v libx264',
        '-preset ultrafast',
        '-profile:v baseline',
        '-level 3.1',
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-b:a 192k',
        '-movflags +faststart'
      ])
      .on('start', c => console.log(`▶️ Cena ${index}`, c))
      .on('progress', p => console.log(`⏳ Cena ${index}: ${p.timemark}`))
      .on('end', () => resolve(segPath))
      .on('error', err => reject(err))
      .save(segPath);
  });
};

// ================== ROUTE ==================
app.post(
  '/magic-workflow',
  upload.fields([{ name: 'visuals' }, { name: 'audios' }]),
  async (req, res) => {
    try {
      const visuals = req.files.visuals || [];
      const audios = req.files.audios || [];
      const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];

      if (!visuals.length) {
        return res.status(400).send('Sem imagens ou vídeos');
      }

      const w = 1920;
      const h = 1080;

      const segments = [];

      for (let i = 0; i < visuals.length; i++) {
        const seg = await processScene(
          visuals[i],
          audios[i],
          narrations[i] || '',
          i,
          w,
          h,
          visuals[i].mimetype.startsWith('image/')
        );
        segments.push(seg);
      }

      const listFile = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);
      fs.writeFileSync(listFile, segments.map(s => `file '${s}'`).join('\n'));

      const finalOutput = path.join(OUTPUT_DIR, `final_${Date.now()}.mp4`);

      ffmpeg()
        .input(listFile)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions([
          '-c:v libx264',
          '-c:a aac',
          '-movflags +faststart'
        ])
        .on('end', () => {
          segments.forEach(f => fs.unlinkSync(f));
          fs.unlinkSync(listFile);

          res.json({
            url: `${req.protocol}://${req.get('host')}/outputs/${path.basename(finalOutput)}`
          });
        })
        .on('error', err => res.status(500).send(err.message))
        .save(finalOutput);
    } catch (err) {
      res.status(500).send(err.message);
    }
  }
);

// ================== START ==================
app.listen(PORT, '0.0.0.0', () =>
  console.log(`🚀 Servidor rodando na porta ${PORT}`)
);
