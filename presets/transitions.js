// transitions.js – FFmpeg 6 SAFE
export function getTransitionXfade(id) {
    const map = {
        // Clássicos
        "cut": "fade",  // usado para manter timing
        "fade": "fade",
        "fade-black": "fadeblack",
        "fade-white": "fadewhite",
        "dissolve": "dissolve",

        // Slides
        "slide-left": "slideleft",
        "slide-right": "slideright",
        "slide-up": "slideup",
        "slide-down": "slidedown",

        // Wipes
        "wipe-left": "wipeleft",
        "wipe-right": "wiperight",
        "wipe-up": "wipeup",
        "wipe-down": "wipedown",

        // Push
        "push-left": "slideleft",
        "push-right": "slideright",
        "push-up": "slideup",
        "push-down": "slidedown",

        // Zoom
        "zoom-in": "zoomin",
        "zoom-out": "zoomout",

        // Warp / especiais
        "cross-warp": "crosswarp",
        "warp-zoom": "warpzoom",
        "dreamy": "dreamy",
        "pixelize": "pixelize",
        "ripple": "ripple",
        "waterdrop": "waterdrop",
        "smooth-left": "smoothleft",
        "smooth-right": "smoothright",
        "smooth-up": "smoothup",
        "smooth-down": "smoothdown",
        "cube": "cube",
        "doorway": "doorway",
        "heart": "heart",
        "polkadots": "polkadots",

        // Geometria
        "circle-open": "circleopen",
        "circle-close": "circleclose",
        "rect-crop": "rectcrop",
        "circle-crop": "circlecrop",
        "radial": "radial",
        "checker": "checkerboard",
        "clock": "clock",

        // 3D & Perspectiva
        "tv-off": "tvturnoff",
        "tv-static": "tvstatic",
        "cube-left": "cube",
        "cube-right": "cube",
    };

    return map[id] || "fade";
}
