
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720, config = {}) {
    const d = parseFloat(durationSec) || 5;
    const fps = 24; 
    const totalFrames = Math.ceil(d * fps);
    
    // Configuração de Escala:
    // Upscale inicial para 2x para permitir movimentação (Pan/Tilt) sem bordas pretas
    // O zoompan trabalha cortando uma janela desse upscale.
    const preProcess = `scale=${targetW*2}:${targetH*2}:force_original_aspect_ratio=increase,crop=${targetW*2}:${targetH*2},setsar=1`;
    const postProcess = `scale=${targetW}:${targetH}:flags=lanczos,fps=${fps},format=yuv420p`;
    
    // Duração do filtro
    const base = `:d=${totalFrames}:s=${targetW}x${targetH}:fps=${fps}`; 

    // VARIÁVEIS ÚTEIS DO FFMPEG:
    // iw, ih = largura e altura da entrada (o upscale 2x)
    // zoom = nível de zoom atual
    // on = número do frame atual
    // x, y = coordenadas do canto superior esquerdo da janela
    
    // Centro da imagem (ponto de equilíbrio)
    // Usamos um zoom base de 1.2 ou 1.5 para ter margem para tremer a câmera sem sair da imagem
    const centerX = "(iw-iw/zoom)/2";
    const centerY = "(ih-ih/zoom)/2";

    let z = "1.0";
    let x = centerX;
    let y = centerY;

    switch (moveId) {
        // =================================================================
        // 1. MOVIMENTOS LINEARES (Suaves e Diretos)
        // =================================================================
        case 'static':
            z = "1.0";
            x = "0"; 
            y = "0";
            break;
            
        case 'kenBurns': // Zoom In Suave Padrão
            z = `1.0+(on/${totalFrames})*0.3`; // Vai de 1.0 a 1.3
            break;
            
        case 'zoom-in': // Zoom In Mais Agressivo
            z = `1.0+(on/${totalFrames})*0.6`; // Vai de 1.0 a 1.6
            break;
            
        case 'zoom-out': // Zoom Out
            z = `1.6-(on/${totalFrames})*0.6`; // Vai de 1.6 a 1.0
            break;

        // =================================================================
        // 2. PANORÂMICAS REAIS (Tilt / Pan)
        // Nota: Fixamos o zoom em 1.4 para ter "sobra" de imagem para percorrer
        // =================================================================
        
        case 'mov-pan-slow-l': // Panorâmica para Esquerda (Câmera vai p/ direita)
            z = "1.4";
            x = `(on/${totalFrames}) * (iw-iw/zoom)`; // X vai de 0 até o máximo
            y = centerY;
            break;
            
        case 'mov-pan-slow-r': // Panorâmica para Direita
            z = "1.4";
            x = `(1-(on/${totalFrames})) * (iw-iw/zoom)`; // X vai do máximo até 0
            y = centerY;
            break;
            
        case 'mov-pan-slow-u': // Tilt Up (Câmera sobe -> mostra de baixo p/ cima)
            z = "1.4";
            x = centerX;
            y = `(1-(on/${totalFrames})) * (ih-ih/zoom)`; 
            break;
            
        case 'mov-pan-slow-d': // Tilt Down (Descida -> mostra de cima p/ baixo)
            z = "1.4";
            x = centerX;
            y = `(on/${totalFrames}) * (ih-ih/zoom)`;
            break;

        case 'mov-pan-diag-tl': // Diagonal Top-Left
            z = "1.4";
            x = `(1-(on/${totalFrames})) * (iw-iw/zoom)`;
            y = `(1-(on/${totalFrames})) * (ih-ih/zoom)`;
            break;

        // =================================================================
        // 3. MOVIMENTOS DINÂMICOS & ORGÂNICOS
        // =================================================================

        // ELÁSTICO / RUBBER BAND:
        // Usa seno para criar um efeito de "boing" (zoom in e out cíclico)
        case 'mov-rubber-band':
        case 'mov-scale-pulse':
        case 'mov-zoom-pulse-slow':
            // 1.2 base + oscilação de 0.3. Velocidade controlada pelo 'on'.
            // Sinusoide que faz o zoom pulsar
            z = `1.2 + 0.3*sin(on/20)`; 
            x = centerX;
            y = centerY;
            break;

        // FLUTUAR 3D / FLOAT:
        // Simula um drone parado no ar ou movimento "underwater".
        // Zoom fixo, X e Y oscilam em frequências diferentes (figura de 8).
        case 'mov-3d-float':
        case 'mov-3d-swing-l':
            z = "1.2";
            x = `${centerX} + (iw/zoom/10)*sin(on/40)`; // Oscila X lentamente
            y = `${centerY} + (ih/zoom/15)*cos(on/50)`; // Oscila Y em outro ritmo
            break;

        // CÂMERA DE MÃO / HANDHELD (REALISMO):
        // Simula o tremor natural da mão humana.
        // Frequência mais alta que o float, amplitude menor e mais caótica.
        case 'handheld-1':
        case 'handheld-2':
        case 'mov-walk':
            z = "1.1"; // Zoom leve p/ ter borda
            // Soma de dois senos para criar irregularidade "orgânica"
            x = `${centerX} + (iw/zoom/40)*sin(on/10) + (iw/zoom/80)*sin(on/4)`; 
            y = `${centerY} + (ih/zoom/40)*cos(on/12)`;
            break;

        // TERREMOTO / SHAKE / JITTER:
        // Movimento rápido e agressivo.
        case 'earthquake':
        case 'mov-shake-violent':
        case 'mov-jitter-x':
        case 'mov-glitch-snap':
            z = "1.1";
            // Multiplicadores altos na frequência (on/2) causam vibração rápida
            x = `${centerX} + (iw/zoom/20)*sin(on*10)`; 
            y = `${centerY} + (ih/zoom/20)*cos(on*13)`;
            break;

        // POP UP (Zoom rápido no início e para):
        case 'mov-pop-up':
            // Se frame < 24 (1seg), zoom rápido. Depois mantém.
            z = `if(lte(on,24), 1.0+(on/24)*0.4, 1.4)`;
            break;

        // Padrão (Ken Burns Lento)
        default:
            z = `1.0+(on/${totalFrames})*0.15`;
            x = centerX;
            y = centerY;
            break;
    }

    // Monta o filtro final
    const effect = `zoompan=z='${z}':x='${x}':y='${y}'${base}`;

    return `${preProcess},${effect},${postProcess}`;
}
