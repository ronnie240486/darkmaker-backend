
export function getTransitionXfade(transId) {
    const id = transId?.toLowerCase() || 'fade';

    // MAPA DE "TRADUÇÃO" PARA FILTROS NATIVOS DO FFMPEG
    // Referência XFADE: https://trac.ffmpeg.org/wiki/Xfade
    const map = {
        // === BÁSICOS ===
        'cut': 'fade',          
        'fade': 'fade',         
        'mix': 'dissolve',      
        'black': 'fadeblack',   
        'white': 'fadewhite',   

        // === LUZ & ATMOSFERA (User Request) ===
        'burn': 'fadewhite',           // Melhor aproximação nativa para estouro de luz
        'queimadura de filme': 'fadewhite',
        'flash-bang': 'fadewhite',
        'flash-black': 'fadeblack',
        'lens-flare': 'circleopen',    // Íris abrindo lembra lente
        'lens flare': 'circleopen',
        'light-leak-tr': 'diagtr',     // Luz vazando pelo canto
        'god-rays': 'radial',          // Raios radiais
        'glow-intense': 'dissolve',    // Brilho suave na troca

        // === GLITCH & DIGITAL ===
        'glitch': 'pixelize',
        'digital-noise': 'pixelize',
        'pixelize': 'pixelize',
        'datamosh': 'hblur',           
        
        // === GEOMÉTRICOS ===
        'circle-open': 'circleopen',   
        'circle-close': 'circleclose', 
        'door-open': 'horzopen',       
        'door-close': 'horzclose',     
        'clock-wipe': 'radial',        
        'spiral-wipe': 'spiral',       
        'diamond-zoom': 'diagdist',    

        // === MOVIMENTO ===
        'slide-left': 'slideleft',
        'slide-right': 'slideright',
        'slide-up': 'slideup',
        'slide-down': 'slidedown',
        'push-left': 'pushleft',       
        'push-right': 'pushright',
        'whip-left': 'slideleft',      
        'whip-right': 'slideright',

        // === WIPES ===
        'wipe-left': 'wipeleft',
        'wipe-right': 'wiperight',
        'wipe-up': 'wipeup',
        'wipe-down': 'wipedown',

        // === OUTROS ===
        'zoom-in': 'zoomin',
        'zoom-out': 'zoomout'
    };

    return map[id] || 'fade';
}

export function buildTransitionFilter(clipCount, transitionType, durations, transitionDuration = 0.75) {
    const filters = [];
    let accumulatedDuration = durations[0]; 
    const isCut = transitionType === 'cut';
    
    const safeTransDur = isCut ? 0.1 : Math.min(transitionDuration, 1.5);

    for (let i = 0; i < clipCount - 1; i++) {
        const offset = accumulatedDuration - safeTransDur;
        
        const vIn1 = i === 0 ? "[0:v]" : `[v_tmp${i}]`; 
        const vIn2 = `[${i + 1}:v]`;                    
        const vOut = `[v_tmp${i + 1}]`;                 
        
        const aIn1 = i === 0 ? "[0:a]" : `[a_tmp${i}]`;
        const aIn2 = `[${i + 1}:a]`;
        const aOut = `[a_tmp${i + 1}]`;

        const safeTrans = getTransitionXfade(transitionType);
        
        const fmtOffset = Math.max(0, offset).toFixed(3);

        filters.push(`${vIn1}${vIn2}xfade=transition=${safeTrans}:duration=${safeTransDur}:offset=${fmtOffset}${vOut}`);
        filters.push(`${aIn1}${aIn2}acrossfade=d=${safeTransDur}:c1=tri:c2=tri${aOut}`);

        accumulatedDuration = (accumulatedDuration + durations[i+1]) - safeTransDur;
    }

    const mapV = `[v_tmp${clipCount - 1}]`;
    const mapA = `[a_tmp${clipCount - 1}]`;

    return { 
        filterComplex: filters.join(';'), 
        mapArgs: ['-map', mapV, '-map', mapA] 
    };
}
