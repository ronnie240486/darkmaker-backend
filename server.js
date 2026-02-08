import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import axios from "axios";
import util from "util";

const app = express();
app.use(express.json({ limit: "200mb" }));
app.use(cors());

const TEMP_DIR = "/app/temp";
const OUTPUT_DIR = "/app/outputs";
const PUBLIC_URL = process.env.PUBLIC_URL || "https://darkmaker-backend-production.up.railway.app";

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const ffmpegRun = util.promisify((cmd, callback) => cmd.on("end", () => callback(null)).on("error", callback).run());

async function downloadFile(url, filepath) {
  const writer = fs.createWriteStream(filepath);
  const response = await axios({ url, method: "GET", responseType: "stream" });

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function ensureAudioTrack(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        "-c:v copy",
        "-c:a aac",
        "-af aformat=sample_rates=44100:channel_layouts=stereo"
      ])
      .save(output)
      .on("end", resolve)
      .on("error", reject);
  });
}

async function concatVideosWithTransitions(inputs, output) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();

    inputs.forEach(i => cmd.input(i));

    const filterGraph = buildTransitionFilter(inputs.length);

    cmd
      .complexFilter(filterGraph)
      .outputOptions([
        "-map", "[v_out]",
        "-map", "[a_out]",
        "-c:v libx264",
        "-preset veryfast",
        "-c:a aac",
        "-b:a 192k",
        "-pix_fmt yuv420p"
      ])
      .save(output)
      .on("end", resolve)
      .on("error", reject);
  });
}

function buildTransitionFilter(nInputs) {
  let graph = "";
  let lastV = null;
  let lastA = null;

  for (let i = 0; i < nInputs; i++) {
    const v = `v${i}`;
    const a = `a${i}`;

    graph += `[${i}:v]scale=1920:1080,format=yuv420p[${v}];`;
    graph += `[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[${a}];`;

    if (i === 0) {
      lastV = v;
      lastA = a;
    } else {
      const nextV = `v${i}_mix`;
      const nextA = `a${i}_mix`;

      graph += `[${lastV}][${v}]xfade=transition=fade:duration=1:offset=${i * 7}[${nextV}];`;
      graph += `[${lastA}][${a}]acrossfade=d=1[${nextA}];`;

      lastV = nextV;
      lastA = nextA;
    }
  }

  graph += `[${lastV}]format=yuv420p[v_out];`;
  graph += `[${lastA}]aformat=sample_rates=44100:channel_layouts=stereo[a_out];`;

  return graph;
}

app.post("/api/render/start", async (req, res) => {
  try {
    const { scenes, bgmUrl } = req.body;
    const jobId = "job_" + Date.now();

    const tempPath = path.join(TEMP_DIR, jobId);
    fs.mkdirSync(tempPath, { recursive: true });

    let videoFiles = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];

      const videoPath = path.join(tempPath, `scene_${i}.mp4`);
      const audioFixedPath = path.join(tempPath, `scene_fixed_${i}.mp4`);

      await downloadFile(scene.videoUrl, videoPath);
      await ensureAudioTrack(videoPath, audioFixedPath);

      videoFiles.push(audioFixedPath);
    }

    const finalVideo = path.join(OUTPUT_DIR, `${jobId}_video_final.mp4`);

    await concatVideosWithTransitions(videoFiles, finalVideo);

    if (bgmUrl) {
      const finalWithBgm = path.join(OUTPUT_DIR, `${jobId}_video_bgm.mp4`);

      await new Promise((resolve, reject) => {
        ffmpeg(finalVideo)
          .input(bgmUrl)
          .complexFilter([
            "[0:a][1:a]amix=inputs=2:dropout_transition=2[a]"
          ])
          .outputOptions([
            "-map 0:v",
            "-map [a]",
            "-c:v copy",
            "-c:a aac",
            "-b:a 192k"
          ])
          .save(finalWithBgm)
          .on("end", resolve)
          .on("error", reject);
      });

      return res.json({
        success: true,
        url: `${PUBLIC_URL}/outputs/${path.basename(finalWithBgm)}`
      });
    }

    res.json({
      success: true,
      url: `${PUBLIC_URL}/outputs/${path.basename(finalVideo)}`
    });

  } catch (err) {
    console.error("Render error:", err);
    res.status(500).json({ success: false, error: err.toString() });
  }
});
app.get("/outputs/:file", (req, res) => {
  const filePath = path.join(OUTPUT_DIR, req.params.file);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  res.sendFile(filePath);
});

app.get("/", (req, res) => {
  res.send("DarkMaker Backend Running");
});

// =============== CLEANUP OLD FILES (OPTIONAL) ==================

function cleanupOldFiles() {
  const now = Date.now();
  const maxAge = 1000 * 60 * 60 * 12; // 12 horas

  try {
    const dirs = fs.readdirSync(TEMP_DIR);
    dirs.forEach(d => {
      const full = path.join(TEMP_DIR, d);
      const stats = fs.statSync(full);

      if (now - stats.mtimeMs > maxAge) {
        fs.rmSync(full, { recursive: true, force: true });
        console.log("Removed old temp:", full);
      }
    });

    const outs = fs.readdirSync(OUTPUT_DIR);
    outs.forEach(f => {
      const full = path.join(OUTPUT_DIR, f);
      const stats = fs.statSync(full);

      if (now - stats.mtimeMs > maxAge) {
        fs.rmSync(full, { force: true });
        console.log("Removed old output:", full);
      }
    });

  } catch (e) {
    console.log("Cleanup error:", e);
  }
}

setInterval(cleanupOldFiles, 1000 * 60 * 30); // a cada 30 min

// =============== EXTRA UTIL: SAFE VIDEO PROBE ==================

function getVideoDuration(filepath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filepath, (err, data) => {
      if (err) return resolve(0);
      resolve(data.format.duration || 0);
    });
  });
}

// =============== EXTRA: FORCE STEREO FOR ALL SCENES ============

async function forceStereo(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        "-c:v copy",
        "-c:a aac",
        "-ar 44100",
        "-ac 2"
      ])
      .save(output)
      .on("end", resolve)
      .on("error", reject);
  });
}

// =============== LOGGING HELPERS ===============================

function logScene(scene, index) {
  console.log(`
--- Scene ${index} ---
Video: ${scene.videoUrl}
Audio: ${scene.audioUrl || "none"}
BG: ${scene.bg || "none"}
------------------------`);
}

// =============== FUTURE: MULTI-AUDIO MIX =======================

async function mixAudioTracks(videoPath, audioTrack, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .input(audioTrack)
      .complexFilter([
        "[0:a][1:a]amix=inputs=2:weights=1 1:normalize=1[a]"
      ])
      .outputOptions([
        "-map 0:v",
        "-map [a]",
        "-c:v copy",
        "-c:a aac",
        "-b:a 192k"
      ])
      .save(outputPath)
      .on("end", resolve)
      .on("error", reject);
  });
}

// =============== EXTRA: DEBUG FILTER BUILDER ====================

function debugFilterGraph(graph) {
  console.log("======== FILTER GRAPH BEGIN ========");
  console.log(graph);
  console.log("======== FILTER GRAPH END ==========");
}

// =============== EXPORT FUNCTION FOR DEV ========================

app.post("/api/debug/filter", (req, res) => {
  const { count } = req.body;
  const graph = buildTransitionFilter(count);
  res.send(`<pre>${graph}</pre>`);
});

// ================================================================
// FINAL: START SERVER
// ================================================================

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("DarkMaker backend running on port", PORT);
});
// ================================================================
// SAFETY: ENSURE DIRECTORIES EXIST
// ================================================================

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ================================================================
// SERVER READY
// ================================================================

console.log("DarkMaker backend fully initialized.");
