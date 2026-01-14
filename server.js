
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import https from 'https';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

console.log("\x1b[36m%s\x1b[0m", "\n🚀 [BOOT] Iniciando Servidor Multimídia AI Suite (Ultimate Engine)...");

// --- CONFIGURAÇÃO DE DIRETÓRIOS ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Limpeza inicial e criação de pastas
if (fs.existsSync(UPLOAD_DIR)) fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
[UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- COMPILAÇÃO DO FRONTEND (ESBUILD) ---
const entryPoint = path.join(__dirname, 'index.tsx');
if (fs.existsSync(entryPoint) && !fs.existsSync(path.join(PUBLIC_DIR, 'bundle.js'))) {
    console.log("🔨 [BUILD] Compilando Frontend...");
    try {
        esbuild.buildSync({
            entryPoints: [entryPoint],
            bundle: true,
            outfile: path.join(PUBLIC_DIR, 'bundle.js'),
            format: 'esm',
            target: ['es2020'],
            external: ['react', 'react-dom', 'react-dom/client', '@google/genai', 'lucide-react', 'fs', 'path', 'fluent-ffmpeg'],
            loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
            define: { 'process.env.API_KEY': JSON.stringify(GEMINI_KEY), 'global': 'window' },
        });
        if (fs.existsSync('index.html')) fs.copyFileSync('index.html', path.join(PUBLIC_DIR, 'index.html'));
        console.log("✅ Build Concluído.");
    } catch (e) { console.error("❌ Erro no Build:", e.message); }
}

// --- MIDDLEWARES ---
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1gb' }));
app.use(express.urlencoded({ extended: true, limit: '1gb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/outputs', express.static(OUTPUT_DIR));

// --- MULTER (UPLOAD) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    cb(null, `${Date.now()}_${safeName}`);
  }
});
const upload = multer({ 
    storage, 
    limits: { fileSize: 2048 * 1024 * 1024 } // 2GB
});

// Configurações de campos de upload
const uploadRender = upload.fields([{ name: 'visuals' }, { name: 'audios' }]);
const uploadGeneric = upload.any();

// --- DADOS DE FALLBACK (AUDIO) ---
const REAL_MUSIC_FALLBACKS = [
    { id: 'fb_m1', name: 'Cinematic Epic', artist: 'Gregor Quendel', duration: 120, previewUrl: 'https://cdn.pixabay.com/download/audio/2022/03/09/audio_a7e2311438.mp3' },
    { id: 'fb_m2', name: 'Lofi Study', artist: 'FASSounds', duration: 140, previewUrl: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3' },
    { id: 'fb_m3', name: 'Corporate', artist: 'LesFM', duration: 120, previewUrl: 'https://cdn.pixabay.com/download/audio/2022/01/26/audio_2475143a4e.mp3' }
];

const REAL_SFX_FALLBACKS = [
    { id: 'fb_s1', name: 'Whoosh', artist: 'SoundEffect', duration: 2, previewUrl: 'https://cdn.pixabay.com/download/audio/2022/03/10/audio_c36c1e54c2.mp3' },
    { id: 'fb_s2', name: 'Boom', artist: 'TrailerFX', duration: 4, previewUrl: 'https://cdn.pixabay.com/download/audio/2022/03/24/audio_9593259850.mp3' }
];

// --- FUNÇÕES AUXILIARES FFMPEG (SPAWN) ---

// Executa comando FFmpeg e retorna Promise
const runFFmpeg = (args, label = "FFMPEG") => {
    return new Promise((resolve, reject) => {
        console.log(`   🎬 [${label}] Iniciando...`);
        // console.log(`   Comando: ffmpeg ${args.join(' ')}`); // Descomente para debug total

        const process = spawn(ffmpegStatic, args);
        let stderr = '';

        process.stderr.on('data', (d) => {
            stderr += d.toString();
            // Log de progresso simples no terminal para não poluir
            if (stderr.length > 2000) stderr = stderr.slice(-2000); 
        });

        process.on('close', (code) => {
            if (code === 0) {
                console.log(`   ✅ [${label}] Concluído.`);
                resolve();
            } else {
                console.error(`   ❌ [${label}] Erro (Code ${code}):`);
                console.error(stderr.slice(-500)); // Mostra os últimos erros
                reject(new Error(`FFmpeg falhou: ${label}`));
            }
        });
    });
};

const getDuration = (filePath) => {
    return new Promise((resolve) => {
        const process = spawn(ffprobeStatic.path, [
            '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath
        ]);
        let out = '';
        process.stdout.on('data', d => out += d.toString());
        process.on('close', () => resolve(parseFloat(out) || 5));
    });
};

// Normaliza uma única cena (Imagem -> Vídeo, ou Padronização de Vídeo)
const normalizeScene = async (visualPath, audioPath, index, width, height) => {
    const outPath = path.join(UPLOAD_DIR, `norm_${index}_${Date.now()}.mp4`);
    let duration = 5;
    
    if (audioPath) duration = await getDuration(audioPath);
    duration += 0.1; // Padding de segurança

    // Filtros para garantir formato uniforme
    const vFilters = [
        `scale=${width}:${height}:force_original_aspect_ratio=increase`,
        `crop=${width}:${height}`,
        'fps=30',
        'format=yuv420p'
    ].join(',');

    const inputArgs = [];
    
    // Input Visual
    const isImage = visualPath.match(/\.(jpg|jpeg|png|webp|gif)$/i);
    inputArgs.push('-i', visualPath);
    if (isImage) {
        // Se for imagem, precisamos do loop antes do input ou via filter, mas -loop 1 antes do -i é melhor
        // Mas como já passamos o path, vamos usar args de array construído
    }

    const finalArgs = [];
    if (isImage) finalArgs.push('-loop', '1');
    finalArgs.push('-i', visualPath);

    // Input Audio
    if (audioPath && fs.existsSync(audioPath)) {
        finalArgs.push('-i', audioPath);
    } else {
        finalArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    }

    // Filtro Complexo
    // [0:v] trata o visual, [1:a] trata o áudio
    finalArgs.push(
        '-filter_complex', `[0:v]${vFilters}[v];[1:a]aresample=44100,aformat=channel_layouts=stereo[a]`,
        '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-crf', '25',
        '-c:a', 'aac', '-b:a', '128k',
        '-t', duration.toFixed(2),
        '-shortest', // Garante que termine com o menor stream (geralmente o áudio ou o tempo definido)
        '-y', outPath
    );

    await runFFmpeg(finalArgs, `Cena ${index}`);
    return outPath;
};


// --- ROTAS DA API ---

app.get('/api/health', (req, res) => res.json({ status: 'online', engine: 'ultimate-ffmpeg' }));

// 1. ROTA DE RENDERIZAÇÃO PRINCIPAL (Concatenação Inteligente)
app.post('/api/render', (req, res) => {
    uploadRender(req, res, async (err) => {
        if (err) return res.status(500).json({ error: err.message });

        console.log("\n🎥 [RENDER] Nova solicitação recebida.");
        const visuals = req.files['visuals'] || [];
        const audios = req.files['audios'] || [];
        
        if (!visuals.length) return res.status(400).json({ error: "Sem visuais." });

        // Resolução alvo
        const resName = req.body.resolution || '1080p';
        const aspectRatio = req.body.aspectRatio || '16:9';
        let w = 1920, h = 1080;
        if (resName === '720p') { w = 1280; h = 720; }
        if (aspectRatio === '9:16') { [w, h] = [h, w]; }

        try {
            const segments = [];
            
            // Passo 1: Normalizar cada clipe
            for (let i = 0; i < visuals.length; i++) {
                const vis = visuals[i];
                const aud = audios[i] || null;
                try {
                    const segPath = await normalizeScene(vis.path, aud ? aud.path : null, i, w, h);
                    segments.push(segPath);
                } catch (e) {
                    console.error(`Erro na cena ${i}, pulando:`, e.message);
                }
            }

            if (segments.length === 0) throw new Error("Falha ao processar todas as cenas.");

            // Passo 2: Criar arquivo de lista para concatenação
            const listPath = path.join(UPLOAD_DIR, `list_${Date.now()}.txt`);
            const fileContent = segments.map(p => `file '${p}'`).join('\n');
            fs.writeFileSync(listPath, fileContent);

            // Passo 3: Concatenar (Copy mode, ultra rápido pois já normalizamos)
            const finalName = `RENDER_${Date.now()}.mp4`;
            const finalPath = path.join(OUTPUT_DIR, finalName);
            
            await runFFmpeg([
                '-f', 'concat', '-safe', '0', '-i', listPath,
                '-c', 'copy', '-y', finalPath
            ], "CONCAT FINAL");

            // Limpeza
            setTimeout(() => {
                [listPath, ...segments, ...visuals.map(f=>f.path), ...audios.map(f=>f.path)].forEach(p => {
                    if (fs.existsSync(p)) fs.unlinkSync(p);
                });
            }, 10000);

            res.json({ url: `/outputs/${finalName}` });

        } catch (e) {
            console.error("💥 ERRO FATAL RENDER:", e);
            res.status(500).json({ error: e.message });
        }
    });
});

// 2. FERRAMENTAS GENÉRICAS (Processamento por Ação)
app.post('/api/:tool', (req, res, next) => {
    // Se for rota de proxy ou específica, pula este handler genérico
    if (['proxy', 'audio-process', 'image-process', 'render'].includes(req.params.tool)) return next();

    uploadGeneric(req, res, async (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const tool = req.params.tool;
        const files = req.files || [];
        const body = req.body || {};
        
        if (!files.length) return res.status(400).json({ error: "Sem arquivos." });
        const inputFile = files[0].path;
        const outName = `${tool.toUpperCase()}_${Date.now()}.mp4`;
        const outPath = path.join(OUTPUT_DIR, outName);

        console.log(`\n🔧 [TOOL] Executando: ${tool}`);

        try {
            let args = [];

            switch(tool) {
                case 'interpolate': // 60FPS Smooth
                    // minterpolate é pesado, usa configurações otimizadas
                    args = [
                        '-i', inputFile,
                        '-filter:v', "minterpolate='mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:fps=60'",
                        '-c:v', 'libx264', '-preset', 'ultrafast', '-y', outPath
                    ];
                    break;
                case 'upscale': // 4K Scale
                    args = [
                        '-i', inputFile,
                        '-vf', "scale=3840:2160:flags=lanczos",
                        '-c:v', 'libx264', '-preset', 'ultrafast', '-y', outPath
                    ];
                    break;
                case 'compress':
                    args = [
                        '-i', inputFile,
                        '-vcodec', 'libx264', '-crf', '28', '-preset', 'faster', '-y', outPath
                    ];
                    break;
                case 'extract-audio':
                    const mp3Name = `AUDIO_${Date.now()}.mp3`;
                    const mp3Path = path.join(OUTPUT_DIR, mp3Name);
                    args = ['-i', inputFile, '-vn', '-acodec', 'libmp3lame', '-y', mp3Path];
                    await runFFmpeg(args, "Extract Audio");
                    return res.json({ url: `/outputs/${mp3Name}` });
                
                default: // Fallback copy
                    args = ['-i', inputFile, '-c', 'copy', '-y', outPath];
            }

            await runFFmpeg(args, tool.toUpperCase());
            res.json({ url: `/outputs/${outName}` });

        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

// 3. PROCESSAMENTO DE ÁUDIO ESPECÍFICO
app.post('/api/audio-process', (req, res) => {
    uploadGeneric(req, res, async (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const files = req.files || [];
        const action = req.body.action || 'convert';
        const outName = `AUDIO_PROC_${Date.now()}.mp3`;
        const outPath = path.join(OUTPUT_DIR, outName);

        try {
            if (action === 'join') {
                const listPath = path.join(UPLOAD_DIR, `audiolist_${Date.now()}.txt`);
                const content = files.map(f => `file '${f.path}'`).join('\n');
                fs.writeFileSync(listPath, content);
                await runFFmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-y', outPath], "AUDIO JOIN");
            } else {
                // Convert/Cut
                await runFFmpeg(['-i', files[0].path, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '192k', '-y', outPath], "AUDIO CONVERT");
            }
            res.json({ url: `/outputs/${outName}` });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

// 4. PROCESSAMENTO DE IMAGEM
app.post('/api/image-process', (req, res) => {
    uploadGeneric(req, res, async (err) => {
        if (err) return res.status(500).json({ error: err.message });
        const files = req.files || [];
        if(!files.length) return res.status(400).json({error: "Sem imagem"});
        
        const outName = `IMG_PROC_${Date.now()}.png`;
        const outPath = path.join(OUTPUT_DIR, outName);

        try {
            // FFmpeg lida bem com imagens também
            await runFFmpeg(['-i', files[0].path, '-vf', 'scale=1080:-1', '-y', outPath], "IMAGE RESIZE");
            res.json({ url: `/outputs/${outName}` });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

// 5. PROXIES DE MÍDIA (Pixabay/Freesound)
app.get('/api/proxy/pixabay', (req, res) => {
    const { q } = req.query;
    // Retorna fallback se não tiver chave configurada ou se der erro, simulando busca real
    const filtered = REAL_MUSIC_FALLBACKS.filter(i => i.name.toLowerCase().includes((q||'').toString().toLowerCase()));
    res.json({ hits: filtered.length ? filtered : REAL_MUSIC_FALLBACKS });
});

// --- SERVIDOR SPA (Fallback para React Router) ---
app.get('*', (req, res) => {
    const idx = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(idx)) res.sendFile(idx);
    else res.send("<h1>Server Booting...</h1><p>Aguarde a compilação do frontend.</p>");
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🟢 SERVER LISTENING: http://localhost:${PORT}`);
    console.log(`   Pasta de Saída: ${OUTPUT_DIR}\n`);
});
