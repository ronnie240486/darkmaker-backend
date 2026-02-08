import express from "express";
import cors from "cors";
import { deleteProject, getProjectJson, saveProject } from "./src/data.js";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json({ limit: "2gb" }));
app.use(cors());

ffmpeg.setFfmpegPath(ffmpegPath);

// -------------------------- //
//  FFmpeg async wrapper
// -------------------------- //

function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const proc = ffmpeg().addOptions(args);
        proc.on("end", () => resolve());
        proc.on("error", reject);
        proc.run();
    });
}

function getVideoArgs() {
    return [
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "medium",
        "-crf", "18",
        "-movflags", "+faststart"
    ];
}

function getAudioArgs() {
    return [
        "-c:a", "aac",
        "-b:a", "192k",
        "-ac", "2",
        "-ar", "44100"
    ];
}

// -------------------------- //
//  SAVE PROJECT
// -------------------------- //

app.post("/api/project/save", async (req, res) => {
    try {
        const projectId = await saveProject(req.body);
        res.json({ projectId });
    } catch (e) {
        console.error("Save error:", e);
        res.status(500).json({ error: "Save failed" });
    }
});

// -------------------------- //
//  LOAD PROJECT
// -------------------------- //

app.get("/api/project/get", async (req, res) => {
    try {
        const { id } = req.query;
        const project = await getProjectJson(id);
        res.json(project);
    } catch (e) {
        console.error("Load error:", e);
        res.status(500).json({ error: "Load failed" });
    }
});

// -------------------------- //
//  DELETE PROJECT
// -------------------------- //

app.delete("/api/project/delete", async (req, res) => {
    try {
        const { id } = req.query;
        await deleteProject(id);
        res.json({ success: true });
    } catch (e) {
        console.error("Delete error:", e);
        res.status(500).json({ error: "Delete failed" });
    }
});

// -------------------------- //
//  RENDER PROJECT
// -------------------------- //

app.post("/api/render/start", async (req, res) => {
    const { project } = req.body;
    const projectId = uuidv4();
    const tempDir = `./temp/${projectId}`;
    fs.mkdirSync(tempDir, { recursive: true });

    try {
        const scenes = project.timeline.scenes || [];

        // -------------------------- //
        //  PROCESS EACH SCENE
        // -------------------------- //

        const tempClips = [];

        for (let i = 0; i < scenes.length; i++) {
            const scene = scenes[i];
            const outFile = `${tempDir}/scene_${i}.mp4`;
            tempClips.push(outFile);

            const inputArgs = ["-i", scene.videoUrl];

            let filter = "";
            let mapA = "[a_out]";

            // AUDIO HANDLING — ALWAYS PROTECTED
            if (scene.audioUrl) {
                inputArgs.push("-i", scene.audioUrl);
                filter += `[1:a]apad=pad_len=999999,aformat=sample_rates=44100:channel_layouts=stereo[a_out];`;
            } else {
                filter += `anullsrc=channel_layout=stereo:sample_rate=44100:d=${scene.duration},aformat=sample_rates=44100:channel_layouts=stereo[a_out];`;
            }

            // RESIZE, SCALE ETC.
            filter += `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v_out]`;

            await runFFmpeg([
                "-y",
                ...inputArgs,
                "-filter_complex", filter,
                "-map", "[v_out]",
                "-map", mapA,
                ...getVideoArgs(),
                ...getAudioArgs(),
                outFile
            ]);
        }

        // -------------------------- //
        //  CONCAT OR TRANSITION
        // -------------------------- //

        const finalOut = `${tempDir}/final_no_bgm.mp4`;

        if (project.timeline.transition !== "xfade" || tempClips.length === 1) {
            // NORMAL CONCAT

            const concatList = tempClips.map(f => `file '${f}'`).join("\n");
            fs.writeFileSync(`${tempDir}/concat.txt`, concatList);

            await runFFmpeg([
                "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", `${tempDir}/concat.txt`,
                "-c", "copy",
                finalOut
            ]);

        } else {
            // XFADE WITH AUDIO CROSSFADE

            let filterGraph = "";
            const inputArgs = [];
            let idx = 0;

            tempClips.forEach(f => {
                inputArgs.push("-i", f);
            });

            let prevV = "[0:v]";
            let prevA = "[0:a]";

            for (let i = 1; i < tempClips.length; i++) {
                const dur = project.timeline.transitionDuration || 1;

                const vOut = `[v${i}]`;
                const aOut = `[a${i}]`;

                filterGraph += `${prevV}[${i}:v]xfade=transition=fade:duration=${dur}:offset=${i - 1}${vOut};`;
                filterGraph += `${prevA}[${i}:a]acrossfade=d=${dur}:c1=tri:c2=tri${aOut};`;

                prevV = vOut;
                prevA = aOut;
            }

            // AUDIO FINAL FORMAT FIX (PATCH CRÍTICO)
            filterGraph += `${prevA}aformat=sample_rates=44100:channel_layouts=stereo[a_final];`;

            await runFFmpeg([
                "-y",
                ...inputArgs,
                "-filter_complex", filterGraph,
                "-map", prevV,
                "-map", "[a_final]",
                ...getVideoArgs(),
                ...getAudioArgs(),
                finalOut
            ]);
        }

        // -------------------------- //
        //  BGM MIX FINAL
        // -------------------------- //

        let finalWithBgm = `${tempDir}/final.mp4`;

        if (project.audio?.bgmUrl) {
            await runFFmpeg([
                "-y",
                "-i", finalOut,
                "-i", project.audio.bgmUrl,
                "-filter_complex",
                `[1:a]aloop=loop=-1:size=2e+09,volume=${project.audio.bgmVolume ?? 0.3},apad,aformat=sample_rates=44100:channel_layouts=stereo[bgm];
                 [0:a][bgm]amix=inputs=2:duration=first[a_mix]`,
                "-map", "0:v",
                "-map", "[a_mix]",
                ...getVideoArgs(),
                ...getAudioArgs(),
                finalWithBgm
            ]);
        } else {
            finalWithBgm = finalOut;
        }

        res.json({
            videoUrl: finalWithBgm.replace("./", "")
        });

    } catch (e) {
        console.error("Render error:", e);
        res.status(500).json({ error: "Render failed" });
    }
});

// -------------------------- //

app.listen(4000, () => {
    console.log("API running on port 4000");
});
