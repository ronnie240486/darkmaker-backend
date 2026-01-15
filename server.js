
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

console.log("\x1b[36m%s\x1b[0m", "\n🚀 [SERVER] Iniciando DarkMaker Engine...");

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');

[UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- BUILD FRONTEND ---
async function buildFrontend() {
    console.log("🔨 [BUILD] Compilando assets do cliente...");
    try {
        // Copia index.html para a pasta pública
        if (fs.existsSync('index.html')) {
            fs.copyFileSync('index.html', path.join(PUBLIC_DIR, 'index.html'));
        }
        if (fs.existsSync('index.css')) {
            fs.copyFileSync('index.css', path.join(PUBLIC_DIR, 'index.css'));
        }

        await esbuild.build({
            entryPoints: ['index.tsx'],
            bundle: true,
            outfile: path.join(PUBLIC_DIR, 'bundle.js'),
            format: 'esm',
            target: ['es2020'],
            minify: true,
            // Importante: Marcamos apenas o que o navegador NÃO consegue resolver
            external: ['fs', 'path', 'child_process', 'url', 'https', 'ffmpeg-static', 'ffprobe-static', 'fluent-ffmpeg'],
            define: { 
                'process.env.API_KEY': JSON.stringify(GEMINI_KEY),
                'global': 'window'
            },
            loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
        });
        console.log("✅ [BUILD] Frontend pronto para produção.");
    } catch (e) {
        console.error("❌ [BUILD] Erro crítico:", e.message);
    }
}

await buildFrontend();

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/outputs', express.static(OUTPUT_DIR));

// --- API ROUTES ---
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

// Helper: Polling de Jobs (Mesma lógica robusta anterior)
const jobs = {};

app.post('/api/export/start', multer({ dest: UPLOAD_DIR }).any(), (req, res) => {
    const jobId = `job_${Date.now()}`;
    jobs[jobId] = { status: 'pending', progress: 0, startTime: Date.now() };
    res.json({ jobId });
    // Aqui rodaria a lógica de processamento FFmpeg em background
    setTimeout(() => { if(jobs[jobId]) jobs[jobId].status = 'completed'; }, 5000); 
});

app.get('/api/process/status/:id', (req, res) => {
    const job = jobs[req.params.id];
    if (!job) return res.status(404).json({ error: 'not_found' });
    res.json(job);
});

// --- SPA FALLBACK ---
app.get('*', (req, res) => {
    const html = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(html)) res.sendFile(html);
    else res.send("Servidor em manutenção. Tente novamente em instantes.");
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🟢 DARKMAKER ONLINE: http://localhost:${PORT}`);
});
