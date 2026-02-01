// ------------------------------
// PRESETS PARA FFmpeg 6 100% VÁLIDOS
// ------------------------------

export function getTransitionXfade(type) {
    const map = {
        "fade-black": "fade",
        "fade-white": "fade",
        "crossfade": "fade",
        "mix": "fade",
        "wipe-left": "wipeleft",
        "wipe-right": "wiperight",
        "wipe-up": "wipeup",
        "wipe-down": "wipedown",
        "slide-left": "slideleft",
        "slide-right": "slideright",
        "slide-up": "slideup",
        "slide-down": "slidedown",
        "circle": "circleopen",
        "circle-close": "circleclose",
        "diag-tl": "diagtl",
        "diag-br": "diagbr",
        "hlslice": "hlslice",
        "vlslice": "vlslice",
        "pixelize": "pixelize",
        "rectcrop": "rectcrop",
        "zoom-in": "zoom",
        "zoom-out": "zoom",
        "fade-through-black": "fade",
        "fade-through-white": "fade",
        "checkerboard": "checkerboard",
        "dissolve": "fade",
    };

    return map[type] || null;
}

// ----------------------------------------------
// CONSTRUTOR PRINCIPAL DE TRANSIÇÕES
// ----------------------------------------------

export function buildTransitionFilter({
    transType,
    duration,
    offset,
    width,
    height
}) {
    const xfadeName = getTransitionXfade(transType);

    if (!xfadeName) {
        console.warn("⚠ Transição não encontrada:", transType);
        return "";
    }

    return `
        [v0][v1] xfade=transition=${xfadeName}:duration=${duration}:offset=${offset}, format=yuv420p [v]
        ;
        [a0][a1] acrossfade=d=${duration} [a]
    `;
}

// ----------------------------------------------
// LISTA COMPLETA DE TRANSIÇÕES SUPORTADAS (FFmpeg 6)
// ----------------------------------------------

export const TRANSITIONS = [
    "fade-black",
    "fade-white",
    "crossfade",
    "mix",
    "dissolve",

    // SLIDES
    "slide-left",
    "slide-right",
    "slide-up",
    "slide-down",

    // WIPES
    "wipe-left",
    "wipe-right",
    "wipe-up",
    "wipe-down",

    // FORMAS
    "circle",
    "circle-close",
    "checkerboard",
    "pixelize",

    // GEOMETRIA
    "diag-tl",
    "diag-br",
    "rectcrop",

    // ZOOM
    "zoom-in",
    "zoom-out"
];

