
export function getTransitionXfade(transId) {
    const id = transId?.toLowerCase() || 'fade';

    // MAPA DE "TRADUÇÃO" PARA FILTROS NATIVOS DO FFMPEG (XFADE)
    // Referência: https://trac.ffmpeg.org/wiki/Xfade
    const map = {
        // === BÁSICOS ===
        'cut': 'fade',          
        'fade': 'fade',         
        'mix': 'dissolve',      
        'black': 'fadeblack',   
        'white': 'fadewhite',   

        // === GEOMÉTRICOS (FORMAS) ===
        'porta abrir': 'horzopen',     // Porta abrindo do centro (Barn Door)
        'door-open': 'horzopen',       
        'door-close': 'horzclose',     
        'vert-open': 'vertopen',       // Olho abrindo
        'circle-open': 'circleopen',   
        'circle-close': 'circleclose', 
        'relogio': 'radial',           
        'clock': 'radial',             
        'clock-wipe': 'radial',        
        'spiral': 'spiral',            
        'diamond': 'diagdist',         

        // === MOVIMENTO ===
        'slide-left': 'slideleft',
        'slide-right': 'slideright',
        'slide-up': 'slideup',
        'slide-down': 'slidedown',
        'push-left': 'pushleft',       
        'push-right': 'pushright',
        'whip-left': 'slideleft',      
        'whip-right': 'slideright',
        'whip chicote': 'slideleft',   

        // === WIPES ===
        'wipe-left': 'wipeleft',
        'wipe-right': 'wiperight',
        'wipe-up': 'wipeup',
        'wipe-down': 'wipedown',

        // === EFEITOS ESPECIAIS ===
        'fumaca': 'dissolve',          // Dissolve é o mais suave para fumaça nativa
        'smoke-reveal': 'dissolve',
        'rasgo de papel': 'hlslice',   // Corte horizontal
        'gota dagua': 'circleopen',    // Onda circular
        'god rays': 'fadewhite',       // Estouro de luz
        'lens flare': 'circleopen',    
        'flash-bang': 'fadewhite',
        
        // Glitch (Pixelização é o único efeito "digital" nativo do xfade)
        'glitch': 'pixelize',
        'glitch colorido': 'pixelize', 
        'color-glitch': 'pixelize',
        'pixelize': 'pixelize',
        'datamosh': 'hblur'            
    };

    return map[id] || 'fade';
}

export function buildTransitionFilter(clipCount, transitionType, durations, transitionDuration = 1.0) {
    const filters = [];
    let accumulatedDuration = durations[0]; 
    const isCut = transitionType === 'cut';
    
    // Aumentamos a duração padrão para 1.0s para transições visuais (porta, relógio) serem notadas
    const safeTransDur = isCut ? 0.1 : Math.min(transitionDuration, 1.5);

    for (let i = 0; i < clipCount - 1; i++) {
        // Offset = Fim do clipe atual MENOS a duração da transição
        // Isso garante que a transição "coma" o final do vídeo A e o começo do vídeo B
        const offset = accumulatedDuration - safeTransDur;
        
        const vIn1 = i === 0 ? "[0:v]" : `[v_tmp${i}]`; 
        const vIn2 = `[${i + 1}:v]`;                    
        const vOut = `[v_tmp${i + 1}]`;                 
        
        const aIn1 = i === 0 ? "[0:a]" : `[a_tmp${i}]`;
        const aIn2 = `[${i + 1}:a]`;
        const aOut = `[a_tmp${i + 1}]`;

        const safeTrans = getTransitionXfade(transitionType);
        
        // Garante precisão de 3 casas decimais e evita offset negativo
        const fmtOffset = Math.max(0, offset).toFixed(3);

        // Filtro de Vídeo (XFADE)
        filters.push(`${vIn1}${vIn2}xfade=transition=${safeTrans}:duration=${safeTransDur}:offset=${fmtOffset}${vOut}`);
        
        // Filtro de Áudio (ACROSSFADE)
        // Importante: O acrossfade mistura os áudios suavemente na mesma duração do vídeo
        filters.push(`${aIn1}${aIn2}acrossfade=d=${safeTransDur}:c1=tri:c2=tri${aOut}`);

        // Atualiza a duração acumulada:
        // Nova = (Acumulado + Duração do Próximo) - Transição (que foi consumida na sobreposição)
        accumulatedDuration = (accumulatedDuration + durations[i+1]) - safeTransDur;
    }

    const mapV = `[v_tmp${clipCount - 1}]`;
    const mapA = `[a_tmp${clipCount - 1}]`;

    return { 
        filterComplex: filters.join(';'), 
        mapArgs: ['-map', mapV, '-map', mapA] 
    };
}
