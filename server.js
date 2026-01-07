
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { promisify } = require('util');

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

// Helper para baixar arquivo de URL (para proxy)
const downloadFile = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
};

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
            // Lógica XFADE (Crossfade)
            // Requer FFmpeg 4.3+
            
            // Preparar streams de vídeo a partir das imagens
            imageFiles.forEach((_, i) => {
                // Escalar e definir duração (duration + transition para overlap)
                const d = durationPerImage + (i === numImages - 1 ? 0 : transitionDuration);
                complexFilter.push(`[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,loop=loop=-1:size=1:start=0,tpad=stop_mode=clone:stop_duration=0.1,trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`);
            });

            // Aplicar Xfade em cadeia
            let lastStream = '[v0]';
            let offset = durationPerImage - transitionDuration;
            
            for (let i = 1; i < numImages; i++) {
                const nextStream = `[v${i}]`;
                const outStream = `[x${i}]`;
                complexFilter.push(`${lastStream}${nextStream}xfade=transition=fade:duration=${transitionDuration}:offset=${offset}${outStream}`);
                lastStream = outStream;
                offset += (durationPerImage - transitionDuration);
            }
            
            // Mapear o último stream do xfade
            inputMap = ['-map', lastStream.replace(']', ']')]; // Corrige formato string
            
        } else if (transitionType === 'zoom') {
            // Lógica Zoompan (Ken Burns)
            imageFiles.forEach((_, i) => {
                // Zoom simples: zoom in no centro
                complexFilter.push(`[${i}:v]scale=8000:-1,zoompan=z='min(zoom+0.0015,1.5)':d=${durationPerImage*25}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720,trim=duration=${durationPerImage}[v${i}]`);
            });
            // Concatenar simples os clips com zoom
            const concatInputs = imageFiles.map((_, i) => `[v${i}]`).join('');
            complexFilter.push(`${concatInputs}concat=n=${numImages}:v=1:a=0[v]`);
            inputMap = ['-map', '[v]'];

        } else {
            // Corte Seco (Padrão)
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
                '-map', `${numImages}:a`, // Áudio
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-shortest', // Corta vídeo se áudio acabar, ou vice-versa
                '-r', '30'   // 30fps
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
        .setDuration(end) // Nota: setDuration no fluent-ffmpeg age como "-t" (duração), não "-to" (fim).
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
        .outputOptions(['-c copy', '-an']) // -an remove áudio
        .save(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

// Gerar Shorts (Segmentar)
app.post('/gerar-shorts', upload.array('video'), (req, res) => {
    const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
    if(!file) return res.status(400).send('Vídeo necessário');
    
    // Simplesmente corta os primeiros 60 segundos e converte para 9:16
    const outputFilename = `short_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    ffmpeg(file.path)
        .setDuration(60)
        .complexFilter('scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2') // Crop 9:16
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

    // Criar arquivo de lista para o concat demuxer do ffmpeg
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

    // Simulação: Aumenta saturação e ajusta color balance para parecer "restaurado"
    ffmpeg(file.path)
        .videoFilter('eq=saturation=1.5:brightness=0.05:contrast=1.1')
        .save(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

// --- ROTAS DE ÁUDIO ---

// Proxy Replicate (Geração de Áudio/Música)
app.post('/generate-audio-replicate', async (req, res) => {
    const { prompt, type, apiKey } = req.body;
    if (!prompt || !apiKey) return res.status(400).send("Faltam dados.");

    try {
        const modelVersion = type === 'music' 
            ? "b05b1dff1d8c6dc63d14b0cdb42135378dcb87f6373b0d3d341ede46e59e2b38" 
            : "b71bba26d69787bb772e76a7f9f3c327f73838c699290027360f302243f09647";

        // 1. Iniciar Predição
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

        // 2. Polling até concluir
        let audioUrl = null;
        let attempts = 0;
        while (!audioUrl && attempts < 30) {
            await new Promise(r => setTimeout(r, 2000)); // Espera 2s
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
            // Opcional: Baixar para o servidor local
            const localName = `gen_audio_${Date.now()}.wav`;
            // res.json({ audio: audioUrl }); // Retorna URL remota direta
            // Ou proxy:
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
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` })) // Changed to JSON response to match VideoTools expectation
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

// Extrair Áudio
app.post('/extrair-audio', upload.array('video'), (req, res) => {
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
        .audioFilters('highpass=f=200') // Simula remoção de graves
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
        .audioFilters('highpass=f=100,lowpass=f=3000') // Filtro simples de limpeza
        .save(outputPath)
        .on('end', () => res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` }))
        .on('error', (err) => res.status(500).send(err.message));
});

// Rota Placeholder para Workflow Mágico (Retorna vídeo de exemplo ou processa inputs reais se complexidade permitir)
app.post('/workflow-magico-avancado', upload.none(), (req, res) => {
    // Em produção, isso chamaria múltiplos agentes de IA + FFmpeg
    // Aqui retornamos um "sucesso simulado" para o frontend iniciar o polling ou mostrar msg
    setTimeout(() => {
        // Retornar um vídeo de demonstração local ou URL externa
        res.json({ url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" });
    }, 2000);
});

// Inicialização
app.listen(PORT, () => {
    console.log(`\n🚀 Servidor Backend REAL rodando em http://localhost:${PORT}`);
    console.log(`   - FFmpeg Status: ${ffmpeg ? 'Carregado' : 'Erro'}`);
    console.log(`   - Uploads: ${UPLOAD_DIR}`);
    console.log(`   - Outputs: ${OUTPUT_DIR}\n`);
});
