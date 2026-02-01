
export function getTransitionXfade(transId) {
    const id = transId?.toLowerCase() || 'fade';

    // Lista Oficial de XFADE do FFmpeg: https://trac.ffmpeg.org/wiki/Xfade
    const map = {
        // --- Clássicos ---
        'cut': 'fade', // Fallback suave
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
        'zoom-spin-fast': 'radial', // Radial simula giro melhor que zoomin puro
        'whip-left': 'slideleft', // Whip é um slide rápido
        'whip-right': 'slideright',
        'whip-up': 'slideup',
        'whip-down': 'slidedown',
        'blur-warp': 'dissolve', // Não existe blur nativo em xfade, usa dissolve
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
        'scan-line-v': 'vslice', // Vslice parece scanline
        'block-glitch': 'hblur', // Horizontal blur parece glitch

        // --- Formas & Geometria ---
        'circle-open': 'circleopen',
        'circle-close': 'circleclose',
        'diamond-zoom': 'diagtl',
        'clock-wipe': 'clock',
        'checker-wipe': 'checkerboard',
        'blind-h': 'horzopen',
        'blind-v': 'vertopen',
        'spiral-wipe': 'spiral',
        'triangle-wipe': 'diagbl',
        'star-zoom': 'circleopen', // Fallback visual

        // --- Luz & Atmosfera ---
        'flash-bang': 'fadewhite',
        'burn': 'fadewhite', // Queimadura de filme = branco estourado
        'light-leak-tr': 'dissolve',
        'lens-flare': 'circleopen', // Iris abrindo
        'god-rays': 'dissolve',
        'glow-intense': 'dissolve',
        'flash-black': 'fadeblack',

        // --- Artístico & Textura ---
        'oil-paint': 'dissolve',
        'ink-splash': 'radial', // Tinta se espalhando
        'paper-rip': 'hlslice', // Corte horizontal parece rasgo
        'page-turn': 'slideleft', // Fallback, page turn real requer GL
        'water-ripple': 'circleopen', // Círculo abrindo = gota
        'smoke-reveal': 'dissolve', // Fumaça = Dissolve suave
        'sketch-reveal': 'diagtl',
        'liquid-melt': 'slidedown', // Derreter = deslizar p/ baixo

        // --- 3D & Perspectiva ---
        'cube-rotate-l': 'slideleft',
        'cube-rotate-r': 'slideright',
        'door-open': 'horzopen', // Porta abrindo
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
    // Se for cut, transição é quase instantânea (0.05), senão usa o padrão
    const safeTransDur = isCut ? 0.05 : Math.min(transitionDuration, 1.0);

    for (let i = 0; i < clipCount - 1; i++) {
        // O offset é o momento exato onde a transição começa
        // Deve ser: Duração Acumulada - Duração da Transição
        const offset = accumulatedDuration - safeTransDur;
        
        const vIn1 = i === 0 ? "[0:v]" : `[v_tmp${i}]`;
        const vIn2 = `[${i + 1}:v]`;
        const vOut = `[v_tmp${i + 1}]`;
        
        const aIn1 = i === 0 ? "[0:a]" : `[a_tmp${i}]`;
        const aIn2 = `[${i + 1}:a]`;
        const aOut = `[a_tmp${i + 1}]`;

        const safeTrans = getTransitionXfade(transitionType);
        
        // Offset deve ser sempre positivo e ter 3 casas decimais
        const fmtOffset = Math.max(0, offset).toFixed(3);

        filters.push(`${vIn1}${vIn2}xfade=transition=${safeTrans}:duration=${safeTransDur}:offset=${fmtOffset}${vOut}`);
        filters.push(`${aIn1}${aIn2}acrossfade=d=${safeTransDur}:c1=tri:c2=tri${aOut}`);

        // Atualiza a duração acumulada:
        // Nova duração = Acumulado + Duração do Próximo Clipe - Transição (pois ela 'come' tempo)
        accumulatedDuration = (accumulatedDuration + (durations[i+1] || 5)) - safeTransDur;
    }

    const mapV = `[v_tmp${clipCount - 1}]`;
    const mapA = `[a_tmp${clipCount - 1}]`;

    return { 
        filterComplex: filters.join(';'), 
        mapArgs: ['-map', mapV, '-map', mapA] 
    };
}
