import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

// Setup de Caminhos para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuração Robusta do FFmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

console.log(`🚀 FFmpeg Path: ${ffmpegStatic}`);
console.log(`🚀 FFprobe Path: ${ffprobeStatic.path}`);

const app = express();
const PORT = 3001;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const TEMP_DIR = path.join(__dirname, 'temp');

// Garantir diretórios
[UPLOAD_DIR, OUTPUT_DIR, TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use('/outputs', express.static(OUTPUT_DIR));

const upload = multer({ 
    storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        filename: (req, file, cb) => cb(null, `raw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
    }),
    limits: { fileSize: 1024 * 1024 * 1024 } // 1GB limit
});

// Helper para extrair índice do nome do arquivo (ex: v_0_scene.mp4 -> 0)
const getIndex = (filename) => {
    const match = filename.match(/[a-z]_(\d+)_/);
    return match ? parseInt(match[1]) : 9999;
};

// Função para processar UM segmento individualmente
const processSegment = (visualPath, audioPath, text, index, isVertical) => {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(TEMP_DIR, `segment_${index}_${Date.now()}.mp4`);
        const width = isVertical ? 1080 : 1920;
        const height = isVertical ? 1920 : 1080;
        
        // Determinar se é imagem
        const isImage = visualPath.match(/\.(jpg|jpeg|png|webp)$/i);
        
        let cmd = ffmpeg();

        // Input Visual
        cmd.input(visualPath);
        if (isImage) {
            cmd.inputOptions(['-loop 1']);
        }

        // Input Audio (ou silêncio se não houver)
        if (audioPath && fs.existsSync(audioPath)) {
            cmd.input(audioPath);
        } else {
            // Gera 5 segundos de silêncio se não tiver áudio
            cmd.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi').inputOptions(['-t 5']);
        }

        // Filtros de Vídeo Complexos
        const filters = [];

        if (isImage) {
            // === EFEITO KEN BURNS (Zoom/Pan) ===
            // Zoom suave para dar vida à imagem estática
            // zoompan requer input em alta resolução antes do scale final
            // Exemplo: zoom inicia em 1.0 e vai até 1.15 ao longo de ~10 segundos (250 frames)
            filters.push(`scale=8000:-1`); // Upscale inicial massivo para evitar pixelização no zoom
            filters.push(`zoompan=z='min(zoom+0.0010,1.5)':d=700:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}`);
        } else {
            // Se for vídeo, apenas escala e crop
            filters.push(`scale=${width}:${height}:force_original_aspect_ratio=increase`);
            filters.push(`crop=${width}:${height}`);
        }

        filters.push(`setsar=1`); // Pixel quadrado obrigatório

        // 2. Texto (Legendas Queimadas)
        if (text) {
            // Sanitização básica do texto para o filtro drawtext
            const sanitizedText = text.replace(/:/g, '\\:').replace(/'/g, '').replace(/\n/g, ' ');
            const fontSize = Math.floor(height * 0.045);
            const yPos = height - Math.floor(height * 0.15);
            
            // Drawtext com background box para legibilidade
            filters.push(`drawtext=text='${sanitizedText}':fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.6:boxborderw=10:x=(w-text_w)/2:y=${yPos}`);
        }

        // Configuração do Pipeline
        cmd.complexFilter([
            // Processamento de Vídeo
            {
                filter: filters.join(','),
                inputs: '0:v',
                outputs: 'v_processed'
            }
        ]);

        // Mapeamento
        const outputOptions = [
            '-map [v_processed]',
            '-map 1:a?', // Mapeia áudio se existir (input 1)
            '-c:v libx264',
            '-preset ultrafast', // Rápido para evitar timeout
            '-pix_fmt yuv420p', // Compatibilidade máxima
            '-r 30', // Framerate fixo 30fps
            '-c:a aac',
            '-ar 44100',
            '-ac 2'
        ];

        // Se tiver áudio real, corta o vídeo quando o áudio acaba.
        // Se não tiver (silêncio gerado), usa a duração do silêncio.
        outputOptions.push('-shortest');

        cmd.outputOptions(outputOptions);

        cmd.save(outputPath)
           .on('end', () => resolve(outputPath))
           .on('error', (err) => {
               console.error(`❌ Erro no segmento ${index}:`, err);
               reject(err);
           });
    });
};

app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    console.log("🎬 Iniciando Renderização Turbo com Movimentos...");
    
    try {
        const visualFiles = (req.files['visuals'] || []).sort((a, b) => getIndex(a.originalname) - getIndex(b.originalname));
        const audioFiles = (req.files['audios'] || []).sort((a, b) => getIndex(a.originalname) - getIndex(b.originalname));
        
        let narrations = [];
        try {
            narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
        } catch (e) { console.log("Sem narrations ou erro de parse"); }

        if (visualFiles.length === 0) throw new Error("Nenhum arquivo visual recebido.");

        const isVertical = req.body.aspectRatio === '9:16';
        const segmentPaths = [];

        // FASE 1: Processar cada segmento individualmente (Normalização + Efeitos)
        console.log(`🔄 Processando ${visualFiles.length} segmentos (Aplicando Zoom/Pan e Legendas)...`);
        
        for (let i = 0; i < visualFiles.length; i++) {
            const visual = visualFiles[i];
            // Encontra áudio correspondente pelo índice ou ordem
            const audio = audioFiles.find(a => getIndex(a.originalname) === getIndex(visual.originalname)) || audioFiles[i];
            const text = narrations[i] || "";

            console.log(`   Processed segment ${i}: ${visual.originalname}`);
            try {
                const segPath = await processSegment(visual.path, audio ? audio.path : null, text, i, isVertical);
                segmentPaths.push(segPath);
            } catch (err) {
                console.error(`Falha ao processar segmento ${i}, pulando...`, err);
            }
        }

        if (segmentPaths.length === 0) throw new Error("Falha ao processar segmentos.");

        // FASE 2: Concatenar segmentos normalizados
        console.log("🔗 Concatenando segmentos...");
        const finalOutputName = `master_${Date.now()}.mp4`;
        const finalOutputPath = path.join(OUTPUT_DIR, finalOutputName);
        
        // Criar arquivo de lista para concat demuxer
        const listPath = path.join(TEMP_DIR, `list_${Date.now()}.txt`);
        const fileListContent = segmentPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(listPath, fileListContent);

        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(listPath)
                .inputOptions(['-f concat', '-safe 0'])
                .outputOptions(['-c copy']) // Copia streams sem re-codificar (muito rápido e sem perdas)
                .save(finalOutputPath)
                .on('end', resolve)
                .on('error', reject);
        });

        console.log("✅ Renderização Concluída!");
        
        // Limpeza (opcional, pode ser movida para cronjob)
        setTimeout(() => {
            try {
                [...segmentPaths, listPath].forEach(p => { if(fs.existsSync(p)) fs.unlinkSync(p); });
                visualFiles.forEach(f => fs.unlinkSync(f.path));
                audioFiles.forEach(f => fs.unlinkSync(f.path));
            } catch(e) { console.error("Erro na limpeza:", e); }
        }, 30000);

        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        res.json({ url: `${protocol}://${host}/outputs/${finalOutputName}` });

    } catch (error) {
        console.error("❌ ERRO FATAL NO SERVIDOR:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ==================================================
    🎥 DARKMAKER RENDER ENGINE V3 (MOTION + ZOOM)
    ✅ Server running on port ${PORT}
    ✅ FFmpeg Static Loaded
    ✅ Motion Effects Enabled
    ==================================================
    `);
});
