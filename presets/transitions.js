export function buildTransitionFilter(clipCount, transitionType, clipDuration, transitionDuration = 1) {
    let videoFilter = "";
    let audioFilter = "";
    
    // Calcula onde as transições ocorrem. 
    // Assumimos que todos os clips têm duração idêntica (clipDuration).
    const offsetBase = clipDuration - transitionDuration;

    for (let i = 0; i < clipCount - 1; i++) {
        const offset = offsetBase * (i + 1);
        
        // Definição dos streams de vídeo
        const vIn1 = i === 0 ? "[0:v]" : `[v${i}]`;
        const vIn2 = `[${i + 1}:v]`;
        const vOut = `[v${i + 1}]`;
        
        // Fallback seguro se não houver tipo definido
        const safeTrans = transitionType || 'fade';
        
        // Filtro XFADE
        videoFilter += `${vIn1}${vIn2}xfade=transition=${safeTrans}:duration=${transitionDuration}:offset=${offset}${vOut};`;

        // Definição dos streams de áudio (Crossfade)
        const aIn1 = i === 0 ? "[0:a]" : `[a${i}]`;
        const aIn2 = `[${i + 1}:a]`;
        const aOut = `[a${i + 1}]`;
        
        audioFilter += `${aIn1}${aIn2}acrossfade=d=${transitionDuration}:c1=tri:c2=tri${aOut};`;
    }

    // Mapeamento final para o FFmpeg pegar o último link da cadeia
    const mapV = `[v${clipCount - 1}]`;
    const mapA = `[a${clipCount - 1}]`;

    return { 
        filterComplex: videoFilter + audioFilter, 
        mapArgs: ['-map', mapV, '-map', mapA] 
    };
}
