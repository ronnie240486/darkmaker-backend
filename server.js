
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

// --- CONFIGURAÇÃO DO FFMPEG ---
let ffmpegPath, ffprobePath;
try {
    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    ffprobePath = require('@ffprobe-installer/ffprobe').path;
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
    process.env.FFMPEG_PATH = ffmpegPath;
    process.env.FFPROBE_PATH = ffprobePath;
    console.log(`✅ Motor FFmpeg Turbo v3.4 Ativo.`);
} catch (error) {
    console.error("❌ Erro ao localizar FFmpeg:", error);
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
    cb(null, `raw_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`);
  }
});
const upload = multer({ storage: storage });

/**
 * Sanitiza texto para o filtro drawtext do FFmpeg.
 * O FFmpeg exige escapes complexos para dois-pontos, vírgulas e aspas simples.
 */
function sanitizeForFFmpeg(text) {
    if (!text || text.trim() === '') return ' ';
    return text
        .replace(/\\/g, '\\\\\\\\')
        .replace(/'/g, "'\\\\\\''")
        .replace(/:/g, '\\\\:')
        .replace(/,/g, '\\\\,')
        .replace(/%/g, '\\\\%')
        .replace(/\[/g, '\\\\[')
        .replace(/\]/g, '\\\\]');
}

/**
 * ENDPOINT IA TURBO - RENDERIZADOR MESTRE
 * Gera vídeos segmentados com zoompan, narração e legendas automáticas.
 */
app.post('/ia-turbo', upload.fields([{ name: 'visuals' }, { name: 'audios' }]), async (req, res) => {
    const visualFiles = req.files['visuals'];
    const audioFiles = req.files['audios'] || [];
    const narrations = req.body.narrations ? JSON.parse(req.body.narrations) : [];

    if (!visualFiles || visualFiles.length === 0) {
        return res.status(400).send('Nenhum visual enviado.');
    }

    const resolution = req.body.resolution || '1080p';
    const isVertical = req.body.aspectRatio === '9:16';
    
    let targetW = isVertical ? 1080 : (resolution === '4K' ? 3840 : 1920);
    let targetH = isVertical ? 1920 : (resolution === '4K' ? 2160 : 1080);

    // Forçar dimensões pares para compatibilidade com libx264
    targetW = Math.floor(targetW / 2) * 2;
    targetH = Math.floor(targetH / 2) * 2;

    const outputFilename = `final_master_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    try {
        const segmentPaths = [];
        
        for (let i = 0; i < visualFiles.length; i++) {
            const visual = visualFiles[i];
            const narrationAudio = audioFiles[i] || null;
            const textLegend = narrations[i] || '';
            const segmentPath = path.join(UPLOAD_DIR, `seg_${i}_${Date.now()}.mp4`);
            const isImage = visual.mimetype.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(visual.path);
            
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg();

                // Input 0: Visual
                if (isImage) {
                    cmd.input(visual.path).inputOptions(['-loop 1']);
                } else {
                    cmd.input(visual.path);
                }

                // Input 1: Áudio (Narração ou Silêncio)
                if (narrationAudio) {
                    cmd.input(narrationAudio.path);
                } else {
                    // Importante: anullsrc gera um fluxo de áudio puro
                    cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputFormat('lavfi');
                }

                let videoFilters = [];

                // 1. Processamento de Imagem/Vídeo e Zoompan
                if (isImage) {
                    const aspect = targetW / targetH;
                    let baseW = 3840;
                    let baseH = Math.floor(3840 / aspect);
                    if (aspect < 1) { baseW = Math.floor(3840 * aspect); baseH = 3840; }
                    
                    baseW = Math.floor(baseW / 2) * 2;
                    baseH = Math.floor(baseH / 2) * 2;

                    videoFilters.push(
                        `scale=${baseW}:${baseH}:force_original_aspect_ratio=increase`,
                        `crop=${baseW}:${baseH}`,
                        `setsar=1/1`,
                        `zoompan=z='min(zoom+0.0012,1.5)':x='trunc(iw/2-(iw/zoom/2))':y='trunc(ih/2-(ih/zoom/2))':s=${targetW}x${targetH}:d=1:fps=30`
                    );
                } else {
                    videoFilters.push(
                        `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`,
                        `crop=${targetW}:${targetH}`,
                        `setsar=1/1`
                    );
                }

                // 2. Filtro de Legendas (Drawtext)
                if (textLegend && textLegend.trim() !== '') {
                    const cleanText = sanitizeForFFmpeg(textLegend);
                    const fontSize = Math.floor(targetH * 0.045);
                    const boxMargin = Math.floor(targetH * 0.15);
                    
                    // Busca por fontes comuns no sistema (Linux/Windows)
                    const fonts = [
                        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
                        "C\\:/Windows/Fonts/arialbd.ttf",
                        "arialbd.ttf"
                    ];
                    let fontPart = "";
                    for (const f of fonts) {
                        if (fs.existsSync(f.replace(/\\\\/g, '\\').replace(/\\:/g, ':'))) {
                            fontPart = `:fontfile='${f}'`;
                            break;
                        }
                    }

                    videoFilters.push(`drawtext=text='${cleanText}'${fontPart}:fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.6:boxborderw=15:x=(w-text_w)/2:y=h-th-${boxMargin}`);
                }

                videoFilters.push(`format=yuv420p`, `fps=30`);

                // 3. Filtros de Áudio
                const audioFilters = [
                    `aresample=44100`,
                    `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo`,
                    `volume=1.2`
                ];

                // Mapeamento Robusto: usamos '1' em vez de '1:a' para aceitar anullsrc (lavfi) sem erros
                cmd.complexFilter([
                    { filter: videoFilters.join(','), inputs: '0:v', outputs: 'v_out' },
                    { filter: audioFilters.join(','), inputs: '1', outputs: 'a_out' }
                ]);

                cmd.map('v_out').map('a_out');

                // Duração fixa para imagens (5s) ou baseada no áudio para vídeos
                if (isImage) {
                    cmd.duration(5);
                }

                cmd.outputOptions([
                    '-c:v libx264',
                    '-preset fast',
                    '-crf 23',
                    '-c:a aac',
                    '-b:a 128k',
                    '-shortest'
                ])
                .save(segmentPath)
                .on('end', () => { 
                    segmentPaths.push(segmentPath); 
                    resolve(); 
                })
                .on('error', (err) => { 
                    console.error(`❌ Erro no segmento ${i}:`, err.message);
                    reject(err); 
                });
            });
        }

        // --- CONCATENAÇÃO FINAL ---
        if (segmentPaths.length === 0) throw new Error("Falha ao renderizar segmentos.");

        const finalCmd = ffmpeg();
        segmentPaths.forEach(p => finalCmd.input(p));
        
        const inputsMapping = segmentPaths.map((_, idx) => `[${idx}:v][${idx}:a]`).join('');
        const concatFilter = `${inputsMapping}concat=n=${segmentPaths.length}:v=1:a=1[v][a]`;

        finalCmd.complexFilter(concatFilter)
            .map('[v]').map('[a]')
            .outputOptions([
                '-c:v libx264',
                '-pix_fmt yuv420p',
                '-c:a aac',
                '-movflags +faststart'
            ])
            .save(outputPath)
            .on('end', () => {
                // Limpar temporários
                segmentPaths.forEach(p => fs.unlink(p, () => {}));
                res.json({ url: `${req.protocol}://${req.get('host')}/outputs/${outputFilename}` });
            })
            .on('error', (err) => {
                console.error("❌ Erro na concatenação:", err.message);
                res.status(500).send(`Erro de Concatenação: ${err.message}`);
            });

    } catch (error) {
        console.error("❌ Erro Crítico:", error.message);
        res.status(500).send(`Erro de Exportação: ${error.message}`);
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor de Renderização v3.4 Ativo na porta ${PORT}`));
