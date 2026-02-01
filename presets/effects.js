// ---------------------------------------------------------
// EFFECTS 100% compatíveis com FFmpeg 6
// ---------------------------------------------------------

export function buildEffectFilter(effectId) {
    switch (effectId) {

        // --------------------------
        // BLUR & FOCUS
        // --------------------------
        case "blur":
            return "boxblur=10:1";

        case "blur-light":
            return "boxblur=5:1";

        case "blur-heavy":
            return "boxblur=20:2";

        case "sharpen":
            return "unsharp=5:5:1.0:5:5:0.0";

        case "focus-in":
            return "boxblur=20:2, fade=t=in:st=0:d=0.5";

        case "focus-out":
            return "boxblur=20:2, fade=t=out:st=0:d=0.5";


        // --------------------------
        // COLOR GRADING
        // --------------------------
        case "cinematic":
            return "eq=contrast=1.2:brightness=-0.03:saturation=1.25";

        case "bw":
            return "hue=s=0";

        case "sepia":
            return "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131";

        case "vibrant":
            return "eq=saturation=1.5";

        case "darken":
            return "eq=brightness=-0.1";

        case "brighten":
            return "eq=brightness=0.1";

        case "cold":
            return "colorbalance=rs=-0.3:bs=0.3";

        case "warm":
            return "colorbalance=rs=0.3:bs=-0.2";


        // --------------------------
        // GLITCH (APENAS FILTROS REAIS)
        // --------------------------
        case "glitch-rgb":
            return "chromashift=cbh=10:crh=-10";

        case "glitch-scanline":
            return "negate, tblend=all_mode=and";

        case "glitch-noise":
            return "noise=alls=20:allf=t";

        case "rgb-split":
            return "chromashift=cbh=5:crh=-5";


        // --------------------------
        // TEXTURE / ART
        // (Somente filtros que FFmpeg possui)
        // --------------------------
        case "oil":
            return "edgedetect=mode=colormix";

        case "sketch":
            return "edgedetect=mode=colormix";

        case "emboss":
            return "convolution='-2 -1 0 -1 1 1 0 1 2'";

        case "film-dust":
            return "noise=alls=30";

        case "film-grain":
            return "noise=alls=10";

        case "dream":
            return "boxblur=8:1, eq=saturation=1.6:brightness=0.05";


        // --------------------------
        // DISTORTIONS
        // --------------------------
        case "shake":
            return "vibrance=intensity=1";

        case "warp":
            return "wave=amplitude=5:frequency=2";

        case "jelly":
            return "wave=amplitude=10:frequency=5";


        default:
            console.warn("⚠ Efeito não encontrado:", effectId);
            return "";
    }
}


// ---------------------------------------------------------
// LISTA DE EFEITOS SUPORTADOS
// ---------------------------------------------------------

export const EFFECTS = [
    "blur",
    "blur-light",
    "blur-heavy",
    "sharpen",
    "focus-in",
    "focus-out",

    "cinematic",
    "bw",
    "sepia",
    "vibrant",
    "cold",
    "warm",
    "darken",
    "brighten",

    "glitch-rgb",
    "glitch-scanline",
    "glitch-noise",
    "rgb-split",

    "oil",
    "sketch",
    "emboss",
    "film-dust",
    "film-grain",
    "dream",

    "warp",
    "shake",
    "jelly"
];
