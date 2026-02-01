
export function getTransitionXfade(transId) {
    const id = transId?.toLowerCase() || 'fade';

    const map = {
        // --- Clássicos ---
        'cut': 'fade',
        'fade': 'fade',
        'black': 'fadeblack',
        'white': 'fadewhite',
        'mix': 'dissolve',

        // --- Movimento (Slides & Wipes) ---
        'slide-left': 'slideleft',
        'slide-right': 'slideright',
        'slide-up': 'slideup',
        'slide-down': 'slidedown',
        'wipe-left': 'wipeleft',
        'wipe-right': 'wiperight',
        'wipe-up': 'wipeup',
        'wipe-down': 'wipedown',
        'push-left': 'pushleft',
        'push-right': 'pushright',

        // --- Zoom & Warp ---
        'zoom-in': 'zoomin',
        'zoom-out': 'zoomout',
        'zoom-spin-fast': 'zoomin', // Simulated
        'whip-left': 'smoothleft',
        'whip-right': 'smoothright',
        'whip-up': 'smoothup',
        'whip-down': 'smoothdown',
        'blur-warp': 'hblur',
        'elastic-left': 'slideleft',

        // --- Glitch & Cyberpunk ---
        'glitch': 'pixelize',
        'color-glitch': 'pixelize',
        'pixelize': 'pixelize',
        'datamosh': 'pixelize',
        'hologram': 'dissolve',
        'cyber-zoom': 'zoomin',
        'digital-noise': 'dissolve',
        'rgb-split': 'dissolve',
        'scan-line-v': 'vslice',
        'block-glitch': 'pixelize',

        // --- Formas & Geometria ---
        'circle-open': 'circleopen',
        'circle-close': 'circleclose',
        'diamond-zoom': 'diagtl',
        'clock-wipe': 'clock',
        'checker-wipe': 'checkerboard',
        'blind-h': 'horzopen',
        'blind-v': 'vertopen',
        'spiral-wipe': 'spiral',
        'triangle-wipe': 'radial',
        'star-zoom': 'circleopen',

        // --- Luz & Atmosfera ---
        'flash-bang': 'fadewhite',
        'burn': 'fadeblack',
        'light-leak-tr': 'dissolve',
        'lens-flare': 'dissolve',
        'god-rays': 'dissolve',
        'glow-intense': 'dissolve',
        'flash-black': 'fadeblack',

        // --- Artístico & Textura ---
        'oil-paint': 'hblur',
        'ink-splash': 'radial',
        'paper-rip': 'slidedown',
        'page-turn': 'slidedown',
        'water-ripple': 'ripple',
        'smoke-reveal': 'fade',
        'sketch-reveal': 'hslice',
        'liquid-melt': 'slidedown',

        // --- 3D & Perspectiva ---
        'cube-rotate-l': 'slideleft',
        'cube-rotate-r': 'slideright',
        'door-open': 'horzopen',
        'flip-card': 'hlslice',
        'room-fly': 'zoomin',
        'film-roll': 'slidedown'
    };

    return map[id] || 'fade';
}

export function buildTransitionFilter(clipCount, transitionType, durations, transitionDuration = 0.5) {
    const filters = [];
    let accumulatedDuration = durations[0] || 5;
    const isCut = transitionType === 'cut';
    const safeTransDur = isCut ? 0.05 : Math.min(transitionDuration, 1.0);

    for (let i = 0; i < clipCount - 1; i++) {
        const offset = accumulatedDuration - safeTransDur;
        
        const vIn1 = i === 0 ? "[0:v]" : `[v_tmp${i}]`;
        const vIn2 = `[${i + 1}:v]`;
        const vOut = `[v_tmp${i + 1}]`;
        
        const aIn1 = i === 0 ? "[0:a]" : `[a_tmp${i}]`;
        const aIn2 = `[${i + 1}:a]`;
        const aOut = `[a_tmp${i + 1}]`;

        const safeTrans = getTransitionXfade(transitionType);
        
        filters.push(`${vIn1}${vIn2}xfade=transition=${safeTrans}:duration=${safeTransDur}:offset=${offset.toFixed(3)}${vOut}`);
        filters.push(`${aIn1}${aIn2}acrossfade=d=${safeTransDur}:c1=tri:c2=tri${aOut}`);

        accumulatedDuration = (accumulatedDuration + (durations[i+1] || 5)) - safeTransDur;
    }

    const mapV = `[v_tmp${clipCount - 1}]`;
    const mapA = `[a_tmp${clipCount - 1}]`;

    return { 
        filterComplex: filters.join(';'), 
        mapArgs: ['-map', mapV, '-map', mapA] 
    };
}
