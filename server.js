
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
// Aponta para os binários estáticos para garantir que funcione em qualquer ambiente Node
try {
    ffmpeg.setFfmpegPath(ffmpegStatic);
    ffmpeg.setFfprobePath(ffprobeStatic.path);
    console.log(`✅ MASTER ENGINE v5.5 (STATIC) - STABILITY PATCH`);
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

// Middleware
app.use(cors({ origin: '*' })); // Em produção, restrinja isso
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(OUTPUT_DIR));

// Configuração de Upload (Multer)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Sanitiza nome do arquivo
    cb(null, `media_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`);
  }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB por arquivo
});

// Utilitário para escapar texto no FFmpeg drawtext
function escapeForDrawtext(text) {
    if (!text) return ' ';
    // FFmpeg requer escape complexo para : e '
    return text.replace(/\\/g, '\\\\\\\\').replace(/'/g, "'\\\\\\''").replace(/:/g, '\\\\:');
}

/**
 * MOTOR DE PROCESSAMENTO DE CENA (VÍDEO + ÁUDIO)
 * Esta função pega 1 imagem/vídeo + 1 áudio e cria um segmento MP4 perfeito de 5 a 10s.
 */
const processScene = async (visual, audio, text, index, w, h, isImg, UPLOAD_DIR) => {
    const segPath = path.join(UPLOAD_DIR, `seg_${index}_${Date.now()}.mp4`);
    
    return new Promise((resolve, reject) => {
        let cmd = ffmpeg();

        // Input 0: Visual (Força loop se for imagem)
        if (isImg) {
            cmd.input(visual.path).inputOptions(['-loop 1', '-t 10']); // Duração padrão 10s
        } else {
            cmd.input(visual.path); // Vídeo usa duração original (será cortado ou extendido via filtros)
        }

        // Input 1: Áudio (ou silêncio gerado)
        if (audio && fs.existsSync(audio.path)) {
            cmd.input(audio.path);
        } else {
            // Gera silêncio se não houver áudio para garantir stream de áudio no concat
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi').inputOptions(['-t 10']);
        }

        // --- FILTROS DE VÍDEO COMPLEXOS ---
        let vFilters = [
            // 1. Escala e Crop para preencher a tela (Cover)
            `scale=${w}:${h}:force_original_aspect_ratio=increase`,
            `crop=${w}:${h}`,
            // 2. Garante SAR 1/1 para evitar distorção em players
            `setsar=1/1`
        ];

        // Efeito Ken Burns (Zoom Lento) apenas para imagens
        if (isImg) {
            vFilters.push(`zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:d=300`); // 300 frames = ~10s
        }

        // Legendas (Drawtext) - Queimadas no vídeo
        if (text && text.trim().length > 0) {
            const sanitizedText = escapeForDrawtext(text);
            // Caixa de texto semitransparente preta + Texto branco centralizado na parte inferior
            vFilters.push(
                `drawtext=text='${sanitizedText}':fontcolor=white:fontsize=(h/20):box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-(text_h*2)`
            );
        }

        // Fade In/Out na cena
        vFilters.push(`fade=t=in:st=0:d=0.5`, `fade=t=out:st=9.5:d=0.5`);
        
        // Garante formato de pixel e framerate
        vFilters.push('format=yuv420p', 'fps=30');

        // --- FILTROS DE ÁUDIO ---
        let aFilters = [
            'aresample=44100',
            'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
            'volume=1.5', // Boost volume leve
            'afade=t=in:st=0:d=0.3',
            'afade=t=out:st=9.7:d=0.3' // Fade out no áudio um pouco antes do vídeo
        ];

        cmd.complexFilter([
            { filter: vFilters.join(','), inputs: '0:v', outputs: 'v_processed' },
            { filter: aFilters.join(','), inputs: '1:a', outputs: 'a_processed' }
        ]);

        // Mapeia saídas dos filtros
        cmd.map('v_processed').map('a_processed');
        
        // Output options robustos
        cmd.outputOptions([
            '-c:v libx264',      // Codec de vídeo universal
            '-preset ultrafast', // Rápido para evitar timeout (troque para 'medium' para qualidade)
            '-c:a aac',          // Codec de áudio universal
            '-b:a 192k',
            '-pix_fmt yuv420p',  // Compatibilidade máxima (QuickTime/Windows)
            '-t 10',             // Duração fixa por cena para estabilidade do demo
            '-movflags +faststart'
        ])
        .save(segPath)
        .on('end', () => {
            // console.log(`Cena ${index} renderizada.`);
            resolve(segPath);
        })
        .on('error', (err) => {
            console.error(`❌ Erro cena ${index}:`, err.message);
            reject(err);
        });
    });
};

/**
 * ROTAS DE VÍDEO
 */
app.post(['/ia-turbo', '/magic-workflow'], upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    // 1. Validação de Entrada
    const visualFiles = req.files['visuals'] || [];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];
    const aspectRatio = req.body.aspectRatio || '16:9';

    if (visualFiles.length === 0) return res.status(400).send('Sem mídia visual para processar.');

    // Define resolução baseada no Aspect Ratio
    const isVertical = aspectRatio === '9:16';
    const w = isVertical ? 1080 : 1920;
    const h = isVertical ? 1920 : 1080;

    const finalOutput = path.join(OUTPUT_DIR, `master_${Date.now()}.mp4`);
    const segments = [];

    // Timeout de segurança global (5 minutos para renderização pesada)
    const timeout = setTimeout(() => {
         if (!res.headersSent) res.status(504).send("Timeout: O vídeo é muito complexo para este servidor demo.");
    }, 300000);

    try {
        console.log(`🎬 Iniciando Renderização Master: ${visualFiles.length} cenas em ${w}x${h}...`);
        
        // 2. Renderização Sequencial de Segmentos
        // Processamos cena por cena para normalizar streams. Isso evita erros de concatenação.
        for (let i = 0; i < visualFiles.length; i++) {
            try {
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
                console.error(`Pular cena ${i} devido a erro crítico:`, err.message);
                // Continua mesmo se uma cena falhar
            }
        }

        if (segments.length === 0) throw new Error("Falha completa: Nenhuma cena foi renderizada com sucesso.");

        // 3. Concatenação Final Inteligente
        // Usa o protocolo 'concat' do FFmpeg que é mais seguro para arquivos normalizados
        const concatCmd = ffmpeg();
        
        // Cria arquivo de lista para concat (método mais seguro para muitos arquivos)
        const listPath = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);
        const fileContent = segments.map(s => `file '${s}'`).join('\n');
        fs.writeFileSync(listPath, fileContent);

        concatCmd
            .input(listPath)
            .inputOptions(['-f concat', '-safe 0'])
            .outputOptions([
                '-c copy', // Copia streams sem re-encodar (rápido pois já normalizamos nas cenas)
                '-movflags +faststart'
            ])
            .save(finalOutput)
            .on('end', () => {
                clearTimeout(timeout);
                console.log(`✅ Master Finalizada: ${finalOutput}`);
                
                // Limpeza (Cleanup)
                segments.forEach(s => fs.unlink(s, () => {}));
                if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
                
                // Retorna URL
                const protocol = req.protocol;
                const host = req.get('host');
                const fullUrl = `${protocol}://${host}/outputs/${path.basename(finalOutput)}`;
                
                res.json({ url: fullUrl });
            })
            .on('error', (err) => {
                clearTimeout(timeout);
                console.error("❌ Erro Concatenação Final:", err.message);
                res.status(500).send("Erro na montagem final do vídeo: " + err.message);
            });

    } catch (e) {
        clearTimeout(timeout);
        console.error("❌ Falha Geral:", e.message);
        res.status(500).send(e.message);
    }
});

// Outros endpoints simples (Audio, Imagem)
app.post('/process-audio', upload.array('audio'), (req, res) => {
    // Stub simples para áudio (já que o foco era vídeo)
    res.json({ url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' });
});

app.post('/process-image', upload.array('image'), (req, res) => {
    // Stub simples para imagem
    res.json({ url: 'https://via.placeholder.com/1080' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 MASTER ENGINE v5.5 ONLINE NA PORTA ${PORT}`));
