import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURAÇÃO DO FFMPEG ---
try {
    ffmpeg.setFfmpegPath(ffmpegStatic);
    ffmpeg.setFfprobePath(ffprobeStatic.path);
    console.log(`✅ MASTER ENGINE v5.5 (STATIC) - READY`);
} catch (error) {
    console.warn("⚠️ Aviso FFmpeg:", error.message);
}

const app = express();
const PORT = process.env.PORT || 8080;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

// Garante diretórios
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Middleware Global de Log
app.use((req, res, next) => {
    // Ignora logs de requests estáticos para limpar o console
    if (!req.url.startsWith('/outputs')) {
        console.log(`📨 [${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    }
    next();
});

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(OUTPUT_DIR));

// Configuração de Upload (Multer)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    cb(null, `media_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`);
  }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 1024 * 1024 * 1024 } // 1GB limit
});

// Utilitário para escapar texto no FFmpeg drawtext
function escapeForDrawtext(text) {
    if (!text) return ' ';
    return text.replace(/\\/g, '\\\\\\\\').replace(/'/g, "'\\\\\\''").replace(/:/g, '\\\\:');
}

/**
 * MOTOR DE PROCESSAMENTO DE CENA (VÍDEO + ÁUDIO)
 */
const processScene = async (visual, audio, text, index, w, h, isImg, UPLOAD_DIR) => {
    const segPath = path.join(UPLOAD_DIR, `seg_${index}_${Date.now()}.mp4`);
    
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg();

        if (isImg) {
            cmd.input(visual.path).inputOptions(['-loop 1', '-t 10']); 
        } else {
            cmd.input(visual.path); 
        }

        if (audio && fs.existsSync(audio.path)) {
            cmd.input(audio.path);
        } else {
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi').inputOptions(['-t 10']);
        }

        // Filtros otimizados para estabilidade
        let vFilters = [
            `scale=${w}:${h}:force_original_aspect_ratio=increase`,
            `crop=${w}:${h}`,
            `setsar=1/1`
        ];

        if (isImg) {
            // Zoom suave e constante (d=1 fix)
            vFilters.push(`zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:d=1`);
        }

        if (text && text.trim().length > 0) {
            const sanitizedText = escapeForDrawtext(text);
            vFilters.push(
                `drawtext=text='${sanitizedText}':fontcolor=white:fontsize=(h/20):box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-(text_h*2)`
            );
        }

        vFilters.push(`fade=t=in:st=0:d=0.5`, `fade=t=out:st=9.5:d=0.5`);
        vFilters.push('format=yuv420p', 'fps=30');

        let aFilters = [
            'aresample=44100',
            'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
            'volume=1.5',
            'afade=t=in:st=0:d=0.3',
            'afade=t=out:st=9.7:d=0.3'
        ];

        cmd.complexFilter([
            { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_processed' },
            { filter: aFilters.join(','), inputs: '1:a', outputs: 'a_processed' }
        ]);

        cmd.map('v_processed').map('a_processed');
        
        cmd.outputOptions([
            '-c:v libx264',
            '-preset ultrafast', // Máxima velocidade para evitar timeout
            '-c:a aac',
            '-b:a 192k',
            '-pix_fmt yuv420p',
            '-t 10',
            '-shortest',
            '-movflags +faststart'
        ])
        .on('start', commandLine => {
            // console.log(`▶️ Cena ${index}: Processando...`); // Menos spam
        })
        .save(segPath)
        .on('end', () => {
            console.log(`✅ Cena ${index} pronta.`);
            resolve(segPath);
        })
        .on('error', (err) => {
            console.error(`❌ Erro cena ${index}:`, err.message);
            reject(err);
        });
    });
};

/**
 * ROTA PRINCIPAL COM DEBUG DE UPLOAD
 */
const uploadFields = upload.fields([{ name: 'visuals' }, { name: 'audios' }]);

app.post(['/ia-turbo', '/magic-workflow'], (req, res, next) => {
    console.log("⚡ Recebendo dados (Upload iniciado)...");
    uploadFields(req, res, (err) => {
        if (err) {
            console.error("❌ ERRO NO UPLOAD:", err);
            return res.status(500).json({ error: "Erro no upload: " + err.message });
        }
        console.log("📦 Upload concluído! Arquivos recebidos. Iniciando lógica...");
        next();
    });
}, async (req, res) => {
    const visualFiles = req.files['visuals'] || [];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
    const aspectRatio = req.body.aspectRatio || '16:9';

    if (visualFiles.length === 0) return res.status(400).send('Sem mídia visual.');

    const isVertical = aspectRatio === '9:16';
    const w = isVertical ? 1080 : 1920;
    const h = isVertical ? 1920 : 1080;
    const finalOutput = path.join(OUTPUT_DIR, `master_${Date.now()}.mp4`);
    const segments = [];

    // Timeout manual de 10 minutos
    res.setTimeout(600000, () => {
        console.error("❌ Timeout de conexão.");
        res.status(504).send("Timeout: Renderização demorou muito.");
    });

    try {
        console.log(`🎬 RENDERIZANDO: ${visualFiles.length} cenas (${w}x${h})`);
        
        // Processa cenas em série para evitar sobrecarga de CPU/Memória
        for (let i = 0; i < visualFiles.length; i++) {
            try {
                console.log(`... Renderizando cena ${i+1}/${visualFiles.length}`);
                const seg = await processScene(
                    visualFiles[i], 
                    audioFiles[i] || null, 
                    narrations[i] || '', 
                    i, w, h, 
                    visualFiles[i].mimetype.startsWith('image/'), 
                    UPLOAD_DIR
                );
                segments.push(seg);
            } catch (err) {
                console.error(`Pulei cena ${i} (erro crítico)`);
            }
        }

        if (segments.length === 0) throw new Error("Nenhuma cena gerada.");

        const concatCmd = ffmpeg();
        const listPath = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);
        const fileContent = segments.map(s => `file '${s}'`).join('\n');
        fs.writeFileSync(listPath, fileContent);

        console.log("🔗 Concatenando Master...");

        concatCmd
            .input(listPath)
            .inputOptions(['-f concat', '-safe 0'])
            .outputOptions([
                '-c:v libx264', '-preset ultrafast', '-c:a aac', '-movflags +faststart'
            ])
            .save(finalOutput)
            .on('end', () => {
                console.log(`✅ VÍDEO PRONTO: ${path.basename(finalOutput)}`);
                
                // Cleanup rápido
                segments.forEach(s => fs.unlink(s, () => {}));
                fs.unlink(listPath, () => {});
                
                const protocol = req.protocol;
                const host = req.get('host');
                res.json({ url: `${protocol}://${host}/outputs/${path.basename(finalOutput)}` });
            })
            .on('error', (err) => {
                console.error("❌ Erro no Concat:", err.message);
                res.status(500).send(err.message);
            });

    } catch (e) {
        console.error("❌ Erro Fatal:", e.message);
        if (!res.headersSent) res.status(500).send(e.message);
    }
});

// Outras rotas simplificadas
app.post('/process-audio', upload.array('audio'), (req, res) => {
    // Implementação simplificada para teste
    if (!req.files || req.files.length === 0) return res.status(400).send("No files");
    // Apenas retorna o primeiro arquivo como sucesso para teste de fluxo se FFmpeg falhar
    const protocol = req.protocol;
    const host = req.get('host');
    const f = req.files[0];
    const newPath = path.join(OUTPUT_DIR, path.basename(f.path) + '.mp3');
    fs.copyFileSync(f.path, newPath);
    res.json({ url: `${protocol}://${host}/outputs/${path.basename(newPath)}` });
});

app.post('/process-image', upload.array('image'), (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).send("No files");
    const protocol = req.protocol;
    const host = req.get('host');
    const f = req.files[0];
    const newPath = path.join(OUTPUT_DIR, path.basename(f.path) + '.jpg');
    fs.copyFileSync(f.path, newPath);
    res.json({ url: `${protocol}://${host}/outputs/${path.basename(newPath)}` });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 SERVIDOR RODANDO NA PORTA ${PORT}`));
