
export function getTransitionXfade(transId) {
    const id = transId?.toLowerCase() || 'fade';

    // MAPA DE "TRADUÇÃO" PARA FILTROS NATIVOS DO FFMPEG
    // Referência XFADE: https://trac.ffmpeg.org/wiki/Xfade
    const map = {
        // === BÁSICOS ===
        'cut': 'fade',          // Fallback para evitar erro
        'fade': 'fade',         // Fade cruzado clássico
        'mix': 'dissolve',      // Dissolver suave
        'black': 'fadeblack',   // Fade para preto
        'white': 'fadewhite',   // Fade para branco (Flash)

        // === GEOMÉTRICOS (FORMAS) ===
        'circle-open': 'circleopen',   // Círculo abrindo (Íris)
        'circle-close': 'circleclose', // Círculo fechando
        'porta abrir': 'horzopen',     // Porta de celeiro abrindo (Horizontal)
        'door-open': 'horzopen',       // (Inglês)
        'door-close': 'horzclose',     // Porta fechando
        'vert-open': 'vertopen',       // Porta vertical (Olho)
        'relogio': 'radial',           // Ponteiro de relógio
        'clock': 'radial',             // (Inglês)
        'clock-wipe': 'radial',        // (Alias)
        'spiral': 'spiral',            // Espiral
        'spiral-wipe': 'spiral',       // (Alias)
        'diamond': 'diagdist',         // Diamante/Losango
        'diamond-zoom': 'diagdist',    // (Alias)

        // === MOVIMENTO (SLIDES) ===
        'slide-left': 'slideleft',
        'slide-right': 'slideright',
        'slide-up': 'slideup',
        'slide-down': 'slidedown',
        'push-left': 'pushleft',       // Empurrar (diferente de slide)
        'push-right': 'pushright',
        'whip-left': 'slideleft',      // Whip é um slide rápido
        'whip-right': 'slideright',
        'whip chicote': 'slideleft',   // (Alias PT)

        // === WIPES (VARREDURAS) ===
        'wipe-left': 'wipeleft',
        'wipe-right': 'wiperight',
        'wipe-up': 'wipeup',
        'wipe-down': 'wipedown',

        // === EFEITOS ARTÍSTICOS (SIMULADOS) ===
        // Fumaça/Dreams -> Dissolve é o mais próximo nativo sem plugins
        'fumaca': 'dissolve',          
        'smoke-reveal': 'dissolve',
        
        // Rasgo de Papel -> Corte Horizontal (Slice)
        'rasgo de papel': 'hlslice',   
        'paper-rip': 'hlslice',
        
        // Gota D'água -> Círculo abrindo (Onda)
        'gota dagua': 'circleopen',    
        'water-ripple': 'circleopen',
        
        // Efeitos de Luz -> Flash Branco (Estouro)
        'god rays': 'fadewhite',       
        'god-rays': 'fadewhite',
        'lens flare': 'circleopen',    // Íris lembra abertura de lente
        'lens-flare': 'circleopen',
        'flash-bang': 'fadewhite',
        'burn': 'fadewhite',           
        'queimadura de filme': 'fadewhite',

        // Glitch -> Pixelização
        'glitch': 'pixelize',
        'pixelize': 'pixelize',
        'datamosh': 'hblur',           // Blur horizontal parece defeito

        // Outros
        'zoom-in': 'zoomin',
        'zoom-out': 'zoomout',
        'rect-crop': 'rectcrop'
    };

    // Retorna o filtro mapeado ou 'fade' se não encontrar
    // Importante: FFmpeg é case-sensitive nos nomes dos filtros, geralmente tudo minúsculo
    return map[id] || 'fade';
}

export function buildTransitionFilter(clipCount, transitionType, durations, transitionDuration = 0.75) {
    const filters = [];
    // Ajuste: A primeira duração é usada como base
    let accumulatedDuration = durations[0]; 
    const isCut = transitionType === 'cut';
    
    // Se for 'cut', fazemos uma transição super rápida (0.1s) que é imperceptível, 
    // mas mantém a lógica do xfade para não quebrar o pipeline
    const safeTransDur = isCut ? 0.1 : Math.min(transitionDuration, 1.5);

    for (let i = 0; i < clipCount - 1; i++) {
        // Offset precisa ser calculado com precisão
        // Offset = Onde termina o clipe anterior MENOS a duração da transição
        // (A transição come o final do clipe A e o início do clipe B)
        const offset = accumulatedDuration - safeTransDur;
        
        // Labels dos streams no grafo do FFmpeg
        const vIn1 = i === 0 ? "[0:v]" : `[v_tmp${i}]`; // O primeiro vem do input 0, os outros dos temp
        const vIn2 = `[${i + 1}:v]`;                    // Próximo input de vídeo
        const vOut = `[v_tmp${i + 1}]`;                 // Saída temporária
        
        const aIn1 = i === 0 ? "[0:a]" : `[a_tmp${i}]`;
        const aIn2 = `[${i + 1}:a]`;
        const aOut = `[a_tmp${i + 1}]`;

        const safeTrans = getTransitionXfade(transitionType);
        
        // Garante que o offset nunca seja negativo
        const fmtOffset = Math.max(0, offset).toFixed(3);

        // Monta o filtro XFADE (Vídeo)
        filters.push(`${vIn1}${vIn2}xfade=transition=${safeTrans}:duration=${safeTransDur}:offset=${fmtOffset}${vOut}`);
        
        // Monta o filtro ACROSSFADE (Áudio) - sempre crossfade suave
        filters.push(`${aIn1}${aIn2}acrossfade=d=${safeTransDur}:c1=tri:c2=tri${aOut}`);

        // Atualiza a duração acumulada para o próximo loop
        // Nova Duração = Duração Acumulada + Duração do Próximo Clipe - Transição
        accumulatedDuration = (accumulatedDuration + durations[i+1]) - safeTransDur;
    }

    const mapV = `[v_tmp${clipCount - 1}]`;
    const mapA = `[a_tmp${clipCount - 1}]`;

    return { 
        filterComplex: filters.join(';'), 
        mapArgs: ['-map', mapV, '-map', mapA] 
    };
}
