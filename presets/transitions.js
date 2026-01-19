
export function getTransitionXfade(transId) {
    const map = {
        'fade-classic': 'fade', 'crossfade': 'fade', 'mix': 'fade', 'black': 'fadeblack', 'white': 'fadewhite', 'cut': 'cut',
        'wipe-up': 'wipeup', 'wipe-down': 'wipedown', 'wipe-left': 'wipeleft', 'wipe-right': 'wiperight',
        'slide-left': 'slideleft', 'slide-right': 'slideright', 'slide-up': 'slideup', 'slide-down': 'slidedown',
        'push-left': 'slideleft', 'push-right': 'slideright',
        'circle-open': 'circleopen', 'circle-close': 'circleclose',
        'clock-wipe': 'clock', 'spiral-wipe': 'spiral', 'checker-wipe': 'checkerboard',
        'glitch': 'glitchdisplace', 'pixelize': 'pixelize', 'datamosh': 'glitchdisplace',
        'zoom-in': 'zoomin', 'zoom-out': 'zoomout', 'zoom-spin-fast': 'zoomin',
        'whip-left': 'whipleft', 'whip-right': 'whipright', 'whip-up': 'whipup', 'whip-down': 'whipdown'
    };
    return map[transId] || 'fade';
}

/**
 * Constrói o filtro complexo considerando durações variáveis para cada clipe.
 */
export function buildTransitionFilter(clipCount, transitionType, scenesData, transitionDuration = 1) {
    const filters = [];
    let accumulatedTime = 0;

    for (let i = 0; i < clipCount - 1; i++) {
        // Pega a duração real da cena atual vinda do frontend
        const currentClipDuration = scenesData[i]?.duration || 5;
        
        // O offset da transição é o tempo acumulado até agora + duração da cena atual - tempo da transição
        // accumulatedTime rastreia o ponto de início do "clipe combinado" atual
        const offset = (accumulatedTime + currentClipDuration) - transitionDuration;
        
        const vIn1 = i === 0 ? "[0:v]" : `[v${i}]`;
        const vIn2 = `[${i + 1}:v]`;
        const vOut = `[v${i + 1}]`;
        const safeTrans = getTransitionXfade(transitionType);
        
        filters.push(`${vIn1}${vIn2}xfade=transition=${safeTrans}:duration=${transitionDuration}:offset=${offset},format=yuv420p${vOut}`);

        const aIn1 = i === 0 ? "[0:a]" : `[a${i}]`;
        const aIn2 = `[${i + 1}:a]`;
        const aOut = `[a${i + 1}]`;
        filters.push(`${aIn1}${aIn2}acrossfade=d=${transitionDuration}:c1=tri:c2=tri${aOut}`);
        
        // Atualiza o tempo acumulado descontando a sobreposição da transição
        accumulatedTime += (currentClipDuration - transitionDuration);
    }

    const mapV = `[v${clipCount - 1}]`;
    const mapA = `[a${clipCount - 1}]`;

    return { 
        filterComplex: filters.join(';'), 
        mapArgs: ['-map', mapV, '-map', mapA] 
    };
}
