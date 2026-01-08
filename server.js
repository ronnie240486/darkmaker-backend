
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { promisify } = require('util');

// Configurar binários do FFmpeg/FFprobe via npm installers
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// Configuração
const app = express();
const PORT = process.env.PORT || 8080;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

// Garantir diretórios
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(OUTPUT_DIR));

// Logger Middleware (Opcional, para debug)
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Rota Raiz (Health Check)
app.get('/', (req, res) => {
    res.status(200).send('DarkMaker Backend API is running. 🚀');
});

// Favicon (evitar 404)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Configuração Multer (Uploads)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    // Sanitizar nome do arquivo para evitar problemas com FFmpeg
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    cb(null, Date.now() + '-' + safeName);
  }
});
const upload = multer({ storage: storage });

// --- FUNÇÕES AUXILIARES ---

// Helper para embaralhar array
const shuffleArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

// --- ROTAS DE VÍDEO (CORE) ---

// 1. Mixar Vídeo Turbo (COM TRANSIÇÕES REAIS)
app.post('/mixar-video-turbo-advanced', upload.fields([{ name: 'narration', maxCount: 1 }, { name: 'images', maxCount: 30 }]), async (req, res) => {
    try {
        const audioFile = req.files['narration']?.[0];
        const imageFiles = req.files['images'];
        
        // Parâmetros do Frontend
        const durationPerImage = parseFloat(req.body.duration) || 5;
        const transitionType = req.body.transition || 'none'; // 'fade', 'zoom', 'none'
        const transitionDuration = 1; // Duração da transição em segundos

        if (!audioFile || !imageFiles || imageFiles.length === 0) {
            return res.status(400).send('Faltam arquivos de áudio ou imagens.');
        }

        const outputFilename = `video_mixed_${Date.now()}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        
        let command = ffmpeg();
        let complexFilter = [];
        let inputMap = [];

        // 1. Preparar Inputs
        imageFiles.forEach((file, i) => {
            command = command.input(file.path);
        });
        command = command.input(audioFile.path); // Áudio é o último input

        const numImages = imageFiles.length;
        const totalDuration = numImages * durationPerImage - ((numImages - 1) * transitionDuration);

        // 2. Construir Filtro Complexo
        if (transitionType === 'fade' && numImages > 1) {
            imageFiles.forEach((_, i) => {
                const d = durationPerImage + (i === numImages - 1 ? 0 : transitionDuration);
                complexFilter.push(`[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,loop=loop=-1:size=1:start=0,tpad=stop_mode=clone:stop_duration=0.1,trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`);
            });

            let lastStream = '[v0]';
            let offset = durationPerImage - transitionDuration;
            
            for (let i = 1; i < numImages; i++) {
                const nextStream = `[v${i}]`;
                const outStream = `[x${i}]`;
                complexFilter.push(`${lastStream}${nextStream}xfade=transition=fade:duration=${transitionDuration}:offset=${offset}${outStream}`);
                lastStream = outStream;
                offset += (durationPerImage - transitionDuration);
            }
            inputMap = ['-map', lastStream.replace(']', ']')];
            
        } else if (transitionType === 'zoom') {
            imageFiles.forEach((_, i) => {
                complexFilter.push(`[${i}:v]scale=8000:-1,zoompan=z='min(zoom+0.0015,1.5)':d=${durationPerImage*25}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720,trim=duration=${durationPerImage}[v${i}]`);
            });
            const concatInputs = imageFiles.map((_, i) => `[v${i}]`).join('');
            complexFilter.push(`${concatInputs}concat=n=${numImages}:v=1:a=0[v]`);
            inputMap = ['-map', '[v]'];
        } else {
            imageFiles.forEach((_, i) => {
                complexFilter.push(`[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,loop=loop=${durationPerImage*30}:size=1:start=0,trim=duration=${durationPerImage}[v${i}]`);
            });
            const concatInputs = imageFiles.map((_, i) => `[v${i}]`).join('');
            complexFilter.push(`${concatInputs}concat=n=${numImages}:v=1:a=0[v]`);
            inputMap = ['-map', '[v]'];
        }

        // Executar
        const finalFilter = complexFilter.join(';');
        
        command
            .complexFilter(finalFilter)
            .outputOptions([
                ...inputMap,
                '-map', `${numImages}:a`,
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-shortest',
                '-r', '30'
            ])
            .save(outputPath)
            .on('end', () => {
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` });
            })
            .on('error', (err) => {
                console.error('FFmpeg Error:', err);
                res.status(500).json({ error: 'Erro na renderização do vídeo.', details: err.message });
            });

    } catch (error) {
        console.error(error);
        res.status(500).send('Erro interno.');
    }
});

// --- UTILITÁRIOS DE VÍDEO ---

// Cortar Vídeo
app.post('/cortar-video', upload.array('video'), (req, res) => {
    const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
    if(!file) return res.status(400).send('Vídeo necessário');
    
    const start = req.body.startTime || '00:00:00';
    const end = req.body.endTime || '00:00:10';
    const outputFilename = `cut_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    ffmpeg(file.path)
        .setStartTime(start)
        .setDuration(end)
        .output(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message))
        .run();
});

// Comprimir Vídeo
app.post('/comprimir-videos', upload.array('video'), (req, res) => {
    const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
    if(!file) return res.status(400).send('Vídeo necessário');
    
    const quality = req.body.quality || 'media';
    const crf = quality === 'alta' ? 18 : quality === 'baixa' ? 35 : 28;
    
    const outputFilename = `compressed_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    ffmpeg(file.path)
        .outputOptions(['-vcodec libx264', `-crf ${crf}`, '-preset veryfast'])
        .save(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

// Remover Áudio
app.post('/remover-audio', upload.array('video'), (req, res) => {
    const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
    if(!file) return res.status(400).send('Vídeo necessário');
    
    const outputFilename = `no_audio_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    ffmpeg(file.path)
        .outputOptions(['-c copy', '-an'])
        .save(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

// Gerar Shorts (Segmentar)
app.post('/gerar-shorts', upload.array('video'), (req, res) => {
    const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
    if(!file) return res.status(400).send('Vídeo necessário');
    
    const outputFilename = `short_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    ffmpeg(file.path)
        .setDuration(60)
        .complexFilter('scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2')
        .save(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

// Unir Vídeos
app.post('/unir-videos', upload.array('video'), (req, res) => {
    if (!req.files || req.files.length < 2) return res.status(400).send('Envie pelo menos 2 vídeos.');
    
    const outputFilename = `merged_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    const listFileName = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);

    const fileContent = req.files.map(f => `file '${f.path}'`).join('\n');
    fs.writeFileSync(listFileName, fileContent);

    ffmpeg()
        .input(listFileName)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions('-c copy')
        .save(outputPath)
        .on('end', () => {
            res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` });
            fs.unlinkSync(listFileName);
        })
        .on('error', (err) => res.status(500).send('Erro: ' + err.message));
});

// Embaralhar Vídeos
app.post('/embaralhar-videos', upload.array('video'), (req, res) => {
    if (!req.files || req.files.length < 2) return res.status(400).send('Envie pelo menos 2 vídeos.');

    const shuffledFiles = shuffleArray([...req.files]);
    const outputFilename = `shuffled_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    const listFileName = path.join(UPLOAD_DIR, `list_shuffle_${Date.now()}.txt`);

    const fileContent = shuffledFiles.map(f => `file '${f.path}'`).join('\n');
    fs.writeFileSync(listFileName, fileContent);

    ffmpeg()
        .input(listFileName)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions('-c copy')
        .save(outputPath)
        .on('end', () => {
            res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` });
            fs.unlinkSync(listFileName);
        })
        .on('error', (err) => res.status(500).send('Erro: ' + err.message));
});

// Upscale (Simulado com Lanczos)
app.post('/upscale-video', upload.array('video'), (req, res) => {
    const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
    if(!file) return res.status(400).send('Vídeo necessário');
    const resolution = req.body.option === '4K (2160p)' ? '3840x2160' : '2560x1440';
    
    const outputFilename = `upscaled_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    ffmpeg(file.path)
        .videoFilter(`scale=${resolution}:flags=lanczos`)
        .save(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

// Colorizar (Simulado - Saturation boost)
app.post('/colorize-video', upload.array('video'), (req, res) => {
    const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
    if(!file) return res.status(400).send('Vídeo necessário');
    
    const outputFilename = `colorized_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    ffmpeg(file.path)
        .videoFilter('eq=saturation=1.5:brightness=0.05:contrast=1.1')
        .save(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

// --- ROTAS DE ÁUDIO ---

// Proxy Replicate
app.post('/generate-audio-replicate', async (req, res) => {
    const { prompt, type, apiKey } = req.body;
    if (!prompt || !apiKey) return res.status(400).send("Faltam dados.");

    try {
        const modelVersion = type === 'music' 
            ? "b05b1dff1d8c6dc63d14b0cdb42135378dcb87f6373b0d3d341ede46e59e2b38" 
            : "b71bba26d69787bb772e76a7f9f3c327f73838c699290027360f302243f09647";

        const startResponse = await fetch("https://api.replicate.com/v1/predictions", {
            method: "POST",
            headers: {
                "Authorization": `Token ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                version: modelVersion,
                input: { prompt: prompt }
            })
        });
        
        if (!startResponse.ok) throw new Error(await startResponse.text());
        const startData = await startResponse.json();
        const getUrl = startData.urls.get;

        let audioUrl = null;
        let attempts = 0;
        while (!audioUrl && attempts < 30) {
            await new Promise(r => setTimeout(r, 2000));
            const pollRes = await fetch(getUrl, {
                headers: { "Authorization": `Token ${apiKey}` }
            });
            const pollData = await pollRes.json();
            if (pollData.status === 'succeeded') {
                audioUrl = pollData.output;
            } else if (pollData.status === 'failed') {
                throw new Error("Replicate falhou.");
            }
            attempts++;
        }

        if (audioUrl) {
            res.json({ audio: audioUrl });
        } else {
            res.status(500).send("Timeout na geração.");
        }

    } catch (e) {
        console.error(e);
        res.status(500).send(e.message);
    }
});

// Unir Áudios
app.post('/unir-audio', upload.array('files'), (req, res) => {
    if (!req.files || req.files.length < 2) return res.status(400).send('Envie 2+ arquivos.');

    const outputFilename = `audio_merged_${Date.now()}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    
    let command = ffmpeg();
    req.files.forEach(f => command = command.input(f.path));

    command
        .mergeToFile(outputPath, UPLOAD_DIR)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

// Embaralhar Áudios
app.post('/embaralhar-audio', upload.array('files'), (req, res) => {
    if (!req.files || req.files.length < 2) return res.status(400).send('Envie pelo menos 2 arquivos.');

    const shuffledFiles = shuffleArray([...req.files]);
    const outputFilename = `audio_shuffled_${Date.now()}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    
    let command = ffmpeg();
    shuffledFiles.forEach(f => command = command.input(f.path));

    command
        .mergeToFile(outputPath, UPLOAD_DIR)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

// Extrair Áudio (Fixed to use 'files' to match frontend)
app.post('/extrair-audio', upload.array('files'), (req, res) => {
    const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
    if(!file) return res.status(400).send('Arquivo necessário.');
    
    const outputFilename = `extracted_${Date.now()}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    ffmpeg(file.path)
        .noVideo()
        .save(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

// Remover Silêncio
app.post('/remover-silencio', upload.array('files'), (req, res) => {
    const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
    if(!file) return res.status(400).send('Arquivo necessário.');
    
    const outputFilename = `silence_removed_${Date.now()}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    ffmpeg(file.path)
        .audioFilters('silenceremove=stop_periods=-1:stop_duration=1:stop_threshold=-30dB')
        .save(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

// Separar Faixas (Simulado)
app.post('/separar-faixas', upload.array('files'), (req, res) => {
    const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
    if(!file) return res.status(400).send('Arquivo necessário.');
    
    const outputFilename = `vocals_simulated_${Date.now()}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    ffmpeg(file.path)
        .audioFilters('highpass=f=200')
        .save(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

// Limpar Metadados Áudio
app.post('/limpar-metadados-audio', upload.array('files'), (req, res) => {
    const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
    if(!file) return res.status(400).send('Arquivo necessário.');
    
    const outputFilename = `clean_meta_${Date.now()}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    ffmpeg(file.path)
        .outputOptions('-map_metadata -1')
        .outputOptions('-c:a copy')
        .save(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

// Melhorar Áudio (Simulado)
app.post('/melhorar-audio', upload.array('files'), (req, res) => {
    const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
    if(!file) return res.status(400).send('Arquivo necessário.');
    
    const outputFilename = `enhanced_${Date.now()}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    ffmpeg(file.path)
        .audioFilters('highpass=f=100,lowpass=f=3000')
        .save(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});
/**
 * Normaliza qualquer arquivo (imagem ou vídeo) para um padrão 720p/30fps MP4
 * Isso é crucial para que o 'concat demuxer' funcione sem erros de mismatch.
 */
const normalizeInput = (filePath) => {
    return new Promise((resolve, reject) => {
        const ext = path.extname(filePath).toLowerCase();
        const outPath = filePath + '_normalized.mp4';
        
        const command = ffmpeg(filePath);

        if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
            // Se for imagem, cria clipe de 5 segundos em loop
            command.inputOptions(['-loop 1', '-t 5']);
        }

        command
            .size('1280x720')
            .aspect('16:9')
            .autoPad(true, 'black')
            .fps(30)
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                '-pix_fmt yuv420p',
                '-preset superfast',
                '-crf 23'
            ])
            .save(outPath)
            .on('end', () => resolve(outPath))
            .on('error', (err) => {
                console.error(`Erro ao normalizar ${filePath}:`, err);
                reject(err);
            });
    });
};

/**
 * Normalizes input sequentially to avoid overloading the server
 */
const normalizeInput = (filePath) => {
    return new Promise((resolve, reject) => {
        const ext = path.extname(filePath).toLowerCase();
        const outPath = filePath + '_normalized.mp4';
        
        const command = ffmpeg(filePath);

        if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
            command.inputOptions(['-loop 1', '-t 5']);
        }

        command
            .size('1280x720')
            .aspect('16:9')
            .autoPad(true, 'black')
            .fps(30)
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                '-pix_fmt yuv420p',
                '-preset superfast',
                '-crf 23'
            ])
            .save(outPath)
            .on('end', () => resolve(outPath))
            .on('error', (err) => {
                console.error(`Normalization error for ${filePath}:`, err);
                reject(err);
            });
    });
};

// Helper to construct secure URLs
const getFullUrl = (req, filename) => {
    const host = req.get('host');
    // Force HTTPS for Railway/Production to prevent Mixed Content blocks
    const protocol = (host.includes('localhost') || host.includes('127.0.0.1')) ? req.protocol : 'https';
    return `${protocol}://${host}/outputs/${filename}`;
};

app.post('/ia-turbo', upload.array('video'), async (req, res) => {
    const files = req.files;
    if (!files || files.length === 0) return res.status(400).send('No files provided.');

    console.log(`🚀 IA TURBO: Processing ${files.length} files...`);
    
    let normalizedPaths = [];
    try {
        const outputFilename = `turbo_master_${Date.now()}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        
        // SEQUENTIAL PROCESSING: Prevents server freezing/crashing on large batches
        for (const file of files) {
            console.log(`  - Normalizing: ${file.filename}`);
            const normalized = await normalizeInput(file.path);
            normalizedPaths.push(normalized);
        }
        
        const listFileName = path.join(UPLOAD_DIR, `turbo_list_${Date.now()}.txt`);
        const fileContent = normalizedPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(listFileName, fileContent);

        console.log(`📦 IA TURBO: Concatenating...`);

        ffmpeg()
            .input(listFileName)
            .inputOptions(['-f concat', '-safe 0'])
            .videoFilters([
                { filter: 'unsharp', options: '3:3:1.0' },
                { filter: 'eq', options: 'saturation=1.1' }
            ])
            .outputOptions([
                '-c:v libx264',
                '-preset fast',
                '-crf 20',
                '-pix_fmt yuv420p',
                '-movflags +faststart'
            ])
            .save(outputPath)
            .on('end', () => {
                fs.unlinkSync(listFileName);
                normalizedPaths.forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
                files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
                
                console.log(`✅ IA TURBO Complete: ${outputFilename}`);
                res.json({ url: getFullUrl(req, outputFilename) });
            })
            .on('error', (err) => {
                console.error("FFmpeg Concat Error:", err);
                res.status(500).send(`Render Error: ${err.message}`);
            });
    } catch (err) {
        console.error("Critical Processing Error:", err);
        normalizedPaths.forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
        res.status(500).send("Server error during mastering.");
    }
});

app.post('/ia-workflow', upload.array('video'), async (req, res) => {
    const files = req.files;
    if (!files || files.length === 0) return res.status(400).send('No files.');

    let normalizedPaths = [];
    try {
        const outputFilename = `workflow_final_${Date.now()}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        
        for (const file of files) {
            const normalized = await normalizeInput(file.path);
            normalizedPaths.push(normalized);
        }
        
        const listFileName = path.join(UPLOAD_DIR, `wf_list_${Date.now()}.txt`);
        const fileContent = normalizedPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(listFileName, fileContent);

        ffmpeg()
            .input(listFileName)
            .inputOptions(['-f concat', '-safe 0'])
            .outputOptions(['-c:v libx264', '-preset superfast', '-crf 22'])
            .save(outputPath)
            .on('end', () => {
                fs.unlinkSync(listFileName);
                normalizedPaths.forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
                res.json({ url: getFullUrl(req, outputFilename) });
            })
            .on('error', (err) => res.status(500).send(err.message));
    } catch (err) {
        res.status(500).send("Workflow failure.");
    }
});

app.post('/remover-audio', upload.single('video'), (req, res) => {
    if(!req.file) return res.status(400).send('No video.');
    const outputFilename = `no_audio_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    ffmpeg(req.file.path).outputOptions(['-c copy', '-an']).save(outputPath)
        .on('end', () => {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            res.json({ url: getFullUrl(req, outputFilename) });
        })
        .on('error', (err) => res.status(500).send(err.message));
});

app.post('/unir-videos', upload.array('video'), (req, res) => {
    if (!req.files || req.files.length < 2) return res.status(400).send('Need 2+ videos.');
    const outputFilename = `merged_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    const listFileName = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);
    fs.writeFileSync(listFileName, req.files.map(f => `file '${f.path}'`).join('\n'));
    ffmpeg().input(listFileName).inputOptions(['-f concat', '-safe 0']).outputOptions('-c copy').save(outputPath)
        .on('end', () => { 
            fs.unlinkSync(listFileName); 
            req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
            res.json({ url: getFullUrl(req, outputFilename) }); 
        })
        .on('error', (err) => res.status(500).send(err.message));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Dedicated Media Backend running on port ${PORT}`);
});
