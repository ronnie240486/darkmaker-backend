
export function getTransitionXfade(transId) {
    const map = {
        // --- BÁSICOS ---
        'fade-classic': 'fade', 
        'crossfade': 'fade', 
        'mix': 'fade', 
        'black': 'fadeblack', 
        'white': 'fadewhite', 
        'cut': 'cut',

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

        // --- FORMAS & IRIS ---
        'circle-open': 'circleopen', 
        'circle-close': 'circleclose',
        'diamond-in': 'diagtl', 
        'diamond-out': 'diagbr', 
        'diamond-zoom': 'diagtl',
        'clock-wipe': 'clock', 
        'iris-in': 'iris', 
        'iris-out': 'iris',
        'triangle-wipe': 'diagtl', 
        'star-zoom': 'circleopen', 
        'spiral-wipe': 'spiral', 
        'heart-wipe': 'circleopen',
        'checker-wipe': 'checkerboard', 
        'checkerboard': 'checkerboard', 
        'grid-flip': 'checkerboard',
        'blind-h': 'hblur', 
        'blind-v': 'vblur', 
        'shutters': 'hblur', 
        'stripes-h': 'hblur', 
        'stripes-v': 'vblur', 
        'barn-door-h': 'hl', 
        'barn-door-v': 'vu',

        // --- GLITCH & DIGITAL ---
        'glitch': 'glitchdisplace', 
        'color-glitch': 'glitchmem', 
        'urban-glitch': 'glitchdisplace',
        'pixelize': 'pixelize', 
        'pixel-sort': 'pixelize', 
        'rgb-shake': 'rgbscanup', 
        'hologram': 'holographic',
        'block-glitch': 'mosaic', 
        'cyber-zoom': 'zoomin', 
        'scan-line-v': 'wipetl', 
        'color-tear': 'glitchmem',
        'digital-noise': 'noise', 
        'glitch-scan': 'rgbscanup', 
        'datamosh': 'glitchdisplace', 
        'rgb-split': 'glitchmem',
        'noise-jump': 'noise', 
        'cyber-slice': 'wipetl', 
        'glitch-chroma': 'glitchmem',
        'visual-buzz': 'glitchdisplace',
        'corrupt-img': 'pixelize',

        // --- MOVIMENTO & WHIP ---
        'zoom-in': 'zoomin', 
        'zoom-out': 'zoomout', 
        'zoom-spin-fast': 'zoomin', 
        'spin-cw': 'wipetl', 
        'spin-ccw': 'wipetr',
        'whip-left': 'whipleft', 
        'whip-right': 'whipright', 
        'whip-up': 'whipup', 
        'whip-down': 'whipdown',
        'perspective-left': 'slideleft', 
        'perspective-right': 'slideright', 
        'zoom-blur-l': 'whipleft', 
        'zoom-blur-r': 'whipright',
        'spin-zoom-in': 'zoomin', 
        'spin-zoom-out': 'zoomout', 
        'whip-diagonal-1': 'wipetl', 
        'whip-diagonal-2': 'wipetr',
        'bounce-scale': 'zoomin', 
        'jelly': 'wipetl',
        'elastic-left': 'slideleft', 
        'elastic-right': 'slideright', 
        'elastic-up': 'slideup', 
        'elastic-down': 'slidedown',

        // --- EFEITOS DE LUZ & ATMOSFERA ---
        'flash-bang': 'fadewhite', 
        'exposure': 'fadewhite', 
        'burn': 'dissolve', 
        'bokeh-blur': 'blur',
        'light-leak-tr': 'fadewhite', 
        'flare-pass': 'wipeleft', 
        'prism-split': 'dissolve', 
        'god-rays': 'fadewhite', 
        'flash-black': 'fadeblack', 
        'flash-white': 'fadewhite', 
        'flashback': 'fadewhite', 
        'lens-flare': 'fadewhite',
        'glow-intense': 'fadewhite',

        // --- ORGÂNICO & TEXTURA ---
        'blood-mist': 'dissolve', 
        'black-smoke': 'fadeblack', 
        'white-smoke': 'fadewhite', 
        'fire-burn': 'dissolve',
        'rip-diag': 'wipetl', 
        'paper-unfold': 'slideleft',
        'page-turn': 'coverleft', 
        'paper-rip': 'wipetl', 
        'burn-paper': 'dissolve', 
        'sketch-reveal': 'dissolve', 
        'fold-up': 'slideup',
        'ink-splash': 'dissolve', 
        'oil-paint': 'dissolve', 
        'water-ripple': 'ripple',
        'smoke-reveal': 'dissolve', 
        'bubble-pop': 'circleopen',
        'liquid-melt': 'dissolve',

        // --- 3D & OUTROS ---
        'cube-rotate-l': 'slideleft', 
        'cube-rotate-r': 'slideright', 
        'cube-rotate-u': 'slideup', 
        'cube-rotate-d': 'slidedown',
        'door-open': 'wipetl', 
        'flip-card': 'slideleft', 
        'room-fly': 'zoomin',
        'luma-fade': 'fade', 
        'film-roll': 'slideup', 
        'film-roll-v': 'slideup',
        'blur-warp': 'blur',
        'filter-blur': 'blur',
        'bubble-blur': 'blur',
        'dynamic-blur': 'blur',
        'blur-dissolve': 'blur'
    };
    return map[transId] || 'fade';
}

export function buildTransitionFilter(durations, transitionType, transitionDuration = 1) {
    const filters = [];
    let currentOffset = 0;
    const clipCount = durations.length;

    for (let i = 0; i < clipCount - 1; i++) {
        const d = durations[i];
        
        // CORREÇÃO DE ÁUDIO CORTADO:
        // A transição 'come' o tempo de duração da transição do vídeo atual.
        // Se a duração da cena for 5s e transição 1s, o vídeo seguinte entra em 4s.
        // O offset deve ser calculado com base nisso.
        
        currentOffset += (d - transitionDuration);
        
        // Segurança: Offset não pode ser negativo ou zero absoluto se for o primeiro
        if (currentOffset < 0) currentOffset = 0;

        const vIn1 = i === 0 ? "[0:v]" : `[v${i}]`;
        const vIn2 = `[${i + 1}:v]`;
        const vOut = `[v${i + 1}]`;
        const safeTrans = getTransitionXfade(transitionType);
        
        filters.push(`${vIn1}${vIn2}xfade=transition=${safeTrans}:duration=${transitionDuration}:offset=${currentOffset},format=yuv420p${vOut}`);

        const aIn1 = i === 0 ? "[0:a]" : `[a${i}]`;
        const aIn2 = `[${i + 1}:a]`;
        const aOut = `[a${i + 1}]`;
        filters.push(`${aIn1}${aIn2}acrossfade=d=${transitionDuration}:c1=tri:c2=tri${aOut}`);
    }

    const mapV = `[v${clipCount - 1}]`;
    const mapA = `[a${clipCount - 1}]`;

    return { 
        filterComplex: filters.join(';'), 
        mapArgs: ['-map', mapV, '-map', mapA] 
    };
}
