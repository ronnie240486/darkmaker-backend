
// Mapa completo de nomes do frontend para transições xfade do FFmpeg
export function getTransitionXfade(transId) {
    const map = {
        // Básicos
        'fade-classic': 'fade', 'crossfade': 'fade', 'mix': 'fade', 
        'black': 'fadeblack', 'white': 'fadewhite', 'fade': 'fade', 'cut': 'cut',

        // Wipes & Slides
        'wipe-up': 'wipeup', 'wipe-down': 'wipedown', 'wipe-left': 'wipeleft', 'wipe-right': 'wiperight',
        'slide-left': 'slideleft', 'slide-right': 'slideright', 'slide-up': 'slideup', 'slide-down': 'slidedown',
        'push-left': 'slideleft', 'push-right': 'slideright', 'slideup': 'slideup', 'slidedown': 'slidedown',

        // Formas
        'circle-open': 'circleopen', 'circle-close': 'circleclose', 'circleopen': 'circleopen',
        'diamond-in': 'diagtl', 'diamond-out': 'diagbr', 'diamond-zoom': 'diagtl',
        'clock-wipe': 'clock', 'iris-in': 'iris', 'iris-out': 'iris',
        'checker-wipe': 'checkerboard', 'checkerboard': 'checkerboard', 'grid-flip': 'checkerboard',
        'triangle-wipe': 'diagtl', 'star-zoom': 'circleopen', 'spiral-wipe': 'spiral', 'heart-wipe': 'circleopen',

        // Glitch & Digital
        'glitch': 'glitchdisplace', 'color-glitch': 'glitchmem', 'urban-glitch': 'glitchdisplace',
        'pixelize': 'pixelize', 'pixel-sort': 'pixelize', 'rgb-shake': 'rgbscanup', 'hologram': 'holographic',
        'block-glitch': 'mosaic', 'cyber-zoom': 'zoomin', 'scan-line-v': 'wipetl', 'color-tear': 'glitchmem',
        'digital-noise': 'noise', 'glitch-scan': 'rgbscanup', 'datamosh': 'glitchdisplace', 'rgb-split': 'glitchmem',
        'noise-jump': 'noise', 'cyber-slice': 'wipetl', 'glitch-chroma': 'glitchmem',

        // Efeitos Especiais & Atmosfera
        'blood-mist': 'dissolve', 'black-smoke': 'fadeblack', 'white-smoke': 'fadewhite', 'fire-burn': 'dissolve',
        'visual-buzz': 'glitchdisplace', 'rip-diag': 'wipetl', 'zoom-neg': 'zoomin', 'infinity-1': 'dissolve',
        'digital-paint': 'dissolve', 'brush-wind': 'wipeleft', 'dust-burst': 'dissolve', 'filter-blur': 'blur',
        'film-roll-v': 'slideup', 'astral-project': 'dissolve', 'lens-flare': 'fadewhite', 'pull-away': 'zoomout',
        'flash-black': 'fadeblack', 'flash-white': 'fadewhite', 'flashback': 'fadewhite', 'combine-overlay': 'dissolve',
        'combine-mix': 'dissolve', 'nightmare': 'dissolve', 'bubble-blur': 'blur', 'paper-unfold': 'slideleft',
        'corrupt-img': 'pixelize', 'glow-intense': 'fadewhite', 'dynamic-blur': 'blur', 'blur-dissolve': 'blur',
        'liquid-melt': 'dissolve', 'ink-splash': 'dissolve', 'oil-paint': 'dissolve', 'water-ripple': 'ripple',
        'smoke-reveal': 'dissolve', 'bubble-pop': 'circleopen', 'hblur': 'hblur',

        // Papel e 3D
        'page-turn': 'coverleft', 'paper-rip': 'wipetl', 'burn-paper': 'dissolve', 'sketch-reveal': 'dissolve', 'fold-up': 'slideup',
        'cube-rotate-l': 'slideleft', 'cube-rotate-r': 'slideright', 'cube-rotate-u': 'slideup', 'cube-rotate-d': 'slidedown',
        'door-open': 'wipetl', 'flip-card': 'slideleft', 'room-fly': 'zoomin',

        // Movimento
        'zoom-in': 'zoomin', 'zoom-out': 'zoomout', 'zoom-spin-fast': 'zoomin', 'spin-cw': 'wipetl', 'spin-ccw': 'wipetr',
        'whip-left': 'whipleft', 'whip-right': 'whipright', 'whip-up': 'whipup', 'whip-down': 'whipdown',
        'perspective-left': 'slideleft', 'perspective-right': 'slideright', 'zoom-blur-l': 'whipleft', 'zoom-blur-r': 'whipright',
        'spin-zoom-in': 'zoomin', 'spin-zoom-out': 'zoomout', 'whip-diagonal-1': 'wipetl', 'whip-diagonal-2': 'wipetr',
        
        // Luz
        'flash-bang': 'fadewhite', 'exposure': 'fadewhite', 'burn': 'dissolve', 'bokeh-blur': 'blur',
        'light-leak-tr': 'fadewhite', 'flare-pass': 'wipeleft', 'prism-split': 'dissolve', 'god-rays': 'fadewhite',
        
        // Elastic
        'elastic-left': 'slideleft', 'elastic-right': 'slideright', 'elastic-up': 'slideup', 'elastic-down': 'slidedown',
        'bounce-scale': 'zoomin', 'jelly': 'wipetl',
        
        'luma-fade': 'fade', 'film-roll': 'slideup', 'blur-warp': 'blur'
    };
    return map[transId] || 'fade';
}

export function buildTransitionFilter(clipCount, transitionType, clipDuration, transitionDuration = 1) {
    let videoFilter = "";
    let audioFilter = "";
    
    // Calcula onde as transições ocorrem. 
    const offsetBase = clipDuration - transitionDuration;

    for (let i = 0; i < clipCount - 1; i++) {
        const offset = offsetBase * (i + 1);
        
        const vIn1 = i === 0 ? "[0:v]" : `[v${i}]`;
        const vIn2 = `[${i + 1}:v]`;
        const vOut = `[v${i + 1}]`;
        
        // Usa o mapa para obter o nome correto do filtro xfade
        const safeTrans = getTransitionXfade(transitionType);
        
        videoFilter += `${vIn1}${vIn2}xfade=transition=${safeTrans}:duration=${transitionDuration}:offset=${offset},format=yuv420p${vOut};`;

        const aIn1 = i === 0 ? "[0:a]" : `[a${i}]`;
        const aIn2 = `[${i + 1}:a]`;
        const aOut = `[a${i + 1}]`;
        
        audioFilter += `${aIn1}${aIn2}acrossfade=d=${transitionDuration}:c1=tri:c2=tri${aOut};`;
    }

    const mapV = `[v${clipCount - 1}]`;
    const mapA = `[a${clipCount - 1}]`;

    return { 
        filterComplex: videoFilter + audioFilter, 
        mapArgs: ['-map', mapV, '-map', mapA] 
    };
}
