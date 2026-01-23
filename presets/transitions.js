
// presets/transitions.js

export function getTransitionXfade(transId) {
    const map = {
        // --- CLÁSSICOS ---
        'fade': 'fade',
        'black': 'fadeblack',
        'white': 'fadewhite',
        'cut': 'cut',
        'dissolve': 'dissolve',
        'mix': 'dissolve',

        // --- WIPES & SLIDES ---
        'wipe-up': 'wipeup',
        'wipe-down': 'wipedown',
        'wipe-left': 'wipeleft',
        'wipe-right': 'wiperight',
        'slide-left': 'slideleft',
        'slide-right': 'slideright',
        'slide-up': 'slideup',
        'slide-down': 'slidedown',
        'push-left': 'slideleft',
        'push-right': 'slideright',

        // --- GEOMÉTRICOS ---
        'circle-open': 'circleopen',
        'circle-close': 'circleclose',
        'checker-wipe': 'checkerboard',
        'spiral-wipe': 'spiral',
        'diamond-zoom': 'diagtl',
        'clock-wipe': 'clock',
        'rect-crop': 'rectcrop',
        'star-zoom': 'circleopen', // Fallback
        'blind-h': 'horzopen',
        'blind-v': 'vertopen',
        'triangle-wipe': 'diagbl',

        // --- GLITCH & DIGITAL ---
        'glitch': 'glitchdisplace',
        'datamosh': 'glitchdisplace',
        'pixelize': 'pixelize',
        'hologram': 'holographic',
        'block-glitch': 'mosaic',
        'rgb-split': 'glitchmem',
        'color-glitch': 'glitchmem',
        'cyber-zoom': 'zoomin',
        'digital-noise': 'pixelize',
        'scan-line-v': 'vuslice',

        // --- ZOOM & WARP ---
        'zoom-in': 'zoomin',
        'zoom-out': 'zoomout',
        'zoom-spin-fast': 'radial',
        'blur-warp': 'blur',
        'elastic-left': 'slideleft',
        'whip-left': 'whipleft',
        'whip-right': 'whipright',
        'whip-up': 'slideup', // Fallback if whipup not avail
        'whip-down': 'slidedown',

        // --- 3D & PERSPECTIVA ---
        'cube-rotate-l': 'slideleft', // No 3d cube in std xfade
        'cube-rotate-r': 'slideright',
        'door-open': 'horzopen',
        'flip-card': 'squeezev',
        'room-fly': 'zoomin',
        'film-roll': 'slideup',
        
        // --- NATURAIS & LUZ ---
        'water-ripple': 'ripple',
        'ink-splash': 'dissolve',
        'smoke-reveal': 'dissolve',
        'flash-bang': 'fadewhite',
        'burn': 'dissolve',
        'light-leak-tr': 'fadewhite',
        'lens-flare': 'dissolve',
        'god-rays': 'dissolve',
        'glow-intense': 'fadewhite',
        'flash-black': 'fadeblack',
        
        // --- ARTISTIC ---
        'oil-paint': 'dissolve',
        'paper-rip': 'hblur',
        'page-turn': 'slideleft',
        'sketch-reveal': 'dissolve',
        'liquid-melt': 'dissolve'
    };
    // Default to fade if unknown
    return map[transId] || 'fade';
}

export function buildTransitionFilter(clipCount, transitionType, durations, transitionDuration = 1) {
    const filters = [];
    let accumulatedDuration = 0;

    const getDur = (i) => Array.isArray(durations) ? (durations[i] || 5) : durations;

    // Start with the first clip duration
    accumulatedDuration = getDur(0);

    for (let i = 0; i < clipCount - 1; i++) {
        // Offset is calculated based on the accumulated end time of the previous sequence minus transition overlap
        const offset = accumulatedDuration - transitionDuration;

        const vIn1 = i === 0 ? "[0:v]" : `[v${i}]`;
        const vIn2 = `[${i + 1}:v]`;
        const vOut = `[v${i + 1}]`;
        const safeTrans = getTransitionXfade(transitionType);
        
        // Always force format to yuv420p to avoid pixel format mismatch during xfade
        filters.push(`${vIn1}${vIn2}xfade=transition=${safeTrans}:duration=${transitionDuration}:offset=${offset},format=yuv420p${vOut}`);

        const aIn1 = i === 0 ? "[0:a]" : `[a${i}]`;
        const aIn2 = `[${i + 1}:a]`;
        const aOut = `[a${i + 1}]`;
        filters.push(`${aIn1}${aIn2}acrossfade=d=${transitionDuration}:c1=tri:c2=tri${aOut}`);

        // Update accumulated duration: add next clip duration, subtract the overlap consumed by transition
        accumulatedDuration = accumulatedDuration + getDur(i + 1) - transitionDuration;
    }

    const mapV = `[v${clipCount - 1}]`;
    const mapA = `[a${clipCount - 1}]`;

    return { 
        filterComplex: filters.join(';'), 
        mapArgs: ['-map', mapV, '-map', mapA] 
    };
}
