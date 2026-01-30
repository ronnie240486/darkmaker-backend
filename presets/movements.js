
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720, config = {}) {
    const d = parseFloat(durationSec) || 5;
    const fps = 24; 
    const totalFrames = Math.ceil(d * fps);
    
    // Escala inicial 2x para garantir qualidade no zoom (evita pixelização)
    // setsar=1 garante pixel quadrado
    const preProcess = `scale=${targetW*2}:${targetH*2}:force_original_aspect_ratio=increase,crop=${targetW*2}:${targetH*2},setsar=1`;
    
    // Escala final para o formato de saída
    const postProcess = `scale=${targetW}:${targetH}:flags=lanczos,fps=${fps},format=yuv420p`;

    // Configuração base do zoompan
    const base = `:d=${totalFrames}:s=${targetW}x${targetH}:fps=${fps}`; 
    
    // Fórmulas de Centralização Padrão
    const centerX = "iw/2-(iw/zoom/2)";
    const centerY = "ih/2-(ih/zoom/2)";

    // Variável de progresso linear (0.0 -> 1.0) baseada no frame atual
    // Garante movimento perfeitamente liso e previsível
    const p = `(on/${totalFrames})`;

    let z = "1.0";
    let x = centerX;
    let y = centerY;

    switch (moveId) {
        // --- ZOOMS ESTÁVEIS ---
        case 'static':
            z = "1.0";
            break;
            
        case 'kenBurns':
            // Zoom suave e lento (1.0 -> 1.25)
            z = `1.0+(${p}*0.25)`;
            break;
            
        case 'zoom-in':
            // Zoom padrão (1.0 -> 1.5)
            z = `1.0+(${p}*0.5)`;
            break;
            
        case 'zoom-out':
            // Zoom Out Linear (1.5 -> 1.0)
            z = `1.5-(${p}*0.5)`;
            break;

        // --- ELASTICIDADE & PULSO (SUAVE) ---
        case 'mov-rubber-band':
        case 'mov-scale-pulse':
        case 'mov-zoom-pulse-slow':
        case 'mov-jelly-wobble':
            // Pulso Senoidal Suave: Vai até 1.3x e volta para 1.0x (Uma respiração completa)
            // Sem tremedeira, apenas um movimento fluido de "ir e vir"
            z = `1.0+(0.3*sin(${p}*3.14159))`;
            break;

        case 'mov-pop-up':
            // Zoom rápido inicial e depois estabiliza
            z = `min(1.0+(${p}*2), 1.2)`;
            break;

        // --- PANS (MOVIMENTOS LATERAIS/VERTICAIS) ---
        // Mantém zoom fixo em 1.2x para ter margem de movimento sem bordas pretas
        
        case 'mov-pan-slow-l': // Panorâmica para Esquerda (Câmera move para direita)
            z = "1.2";
            x = `(${p}) * (iw-iw/zoom)`; 
            break;
            
        case 'mov-pan-slow-r': // Panorâmica para Direita
            z = "1.2";
            x = `(1-${p}) * (iw-iw/zoom)`;
            break;
            
        case 'mov-pan-slow-u': // Tilt Up (Câmera sobe)
            z = "1.2";
            y = `(1-${p}) * (ih-ih/zoom)`;
            break;
            
        case 'mov-pan-slow-d': // Tilt Down (Câmera desce)
            z = "1.2";
            y = `(${p}) * (ih-ih/zoom)`;
            break;

        case 'mov-pan-diag-tl': // Diagonal Top-Left
            z = "1.2";
            x = `(1-${p}) * (iw-iw/zoom)`;
            y = `(1-${p}) * (ih-ih/zoom)`;
            break;

        // --- SUBSTITUIÇÃO DE TREMORES POR MOVIMENTOS ESTÁVEIS ---
        // O usuário pediu "sem tremer", então substituímos efeitos de shake/jitter
        // por movimentos suaves ou pulsos lentos.
        case 'mov-shake-violent':
        case 'earthquake':
        case 'mov-jitter-x':
        case 'mov-glitch-snap':
            // Substituído por um pulso duplo suave para simular impacto sem destruir a estabilidade
            z = `1.1+(0.1*sin(${p}*3.14159*4))`; 
            break;

        // Padrão (Ken Burns Suave) para qualquer ID desconhecido
        default:
            z = `1.0+(${p}*0.2)`;
            x = centerX;
            y = centerY;
            break;
    }

    // Montagem do filtro final
    const effect = `zoompan=z='${z}':x='${x}':y='${y}'${base}`;

    return `${preProcess},${effect},${postProcess}`;
}
