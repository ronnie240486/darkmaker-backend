
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720, config = {}) {
    const d = parseFloat(durationSec) || 5;
    const fps = 24; 
    const totalFrames = Math.ceil(d * fps);
    
    // ==========================================================================================
    // CONFIGURAÇÃO BASE
    // Upscale agressivo (3x) para garantir que zooms e rotações não criem bordas pretas
    // ==========================================================================================
    const preProcess = `scale=${targetW*3}:${targetH*3}:force_original_aspect_ratio=increase,crop=${targetW*3}:${targetH*3},setsar=1`;
    const postProcess = `scale=${targetW}:${targetH}:flags=lanczos,fps=${fps},format=yuv420p`;
    
    // Configuração comum do zoompan
    const zpDur = `:d=${totalFrames}:fps=${fps}:s=${targetW}x${targetH}`;

    // Variáveis de Tempo para Fórmulas Matemáticas do FFmpeg
    // t = progresso de 0.0 a 1.0
    const t = `(on/${totalFrames})`; 
    
    let filterChain = "";

    switch (moveId) {
        // =================================================================
        // 1. ZOOMS (Corrigidos para serem visíveis e fluidos)
        // =================================================================
        
        case 'zoom-in': 
            // Zoom Linear de 1.0x a 1.5x
            filterChain = `zoompan=z='1.0+(0.5*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'zoom-out': 
            // Zoom Linear de 1.5x a 1.0x
            filterChain = `zoompan=z='1.5-(0.5*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'mov-zoom-crash-in': 
            // Zoom Explosivo (Exponencial)
            filterChain = `zoompan=z='1.0+3.0*(${t}*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;
            
        case 'mov-zoom-crash-out': 
            filterChain = `zoompan=z='4.0-3.0*(${t}*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        // =================================================================
        // 2. 3D & ROTAÇÃO (Usa filtro 'rotate' + 'zoompan')
        // =================================================================

        case 'mov-3d-roll': // Rolamento (Dutch Angle)
            // Rotaciona de -5 a +5 graus suavemente
            filterChain = `rotate=angle='5*PI/180*sin(${t}*2*PI)':fillcolor=none:ow='rotw(5*PI/180)':oh='roth(5*PI/180)',zoompan=z='1.2':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'mov-3d-spin-axis': // Giro em Espiral
            // Rotaciona 360 graus lentamente + Zoom In
            filterChain = `rotate=angle='${t}*2*PI':fillcolor=none,zoompan=z='1.5+${t}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'mov-3d-swing-l': // Pêndulo
            // Balança como um pêndulo
            filterChain = `rotate=angle='10*PI/180*sin(${t}*4)':fillcolor=none,zoompan=z='1.4':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        // =================================================================
        // 3. EFEITOS DE FOCO & BLUR (Usa 'boxblur')
        // =================================================================

        case 'mov-blur-pulse': // Pulso de Desfoque
            // Blur oscila com o tempo
            filterChain = `boxblur=luma_radius='20*abs(sin(${t}*PI*3))':luma_power=1,zoompan=z='1.05':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'mov-blur-in': // Começa borrado e foca
            filterChain = `boxblur=luma_radius='40*(1-${t})':luma_power=1,zoompan=z='1.0':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;
            
        case 'mov-blur-out': // Começa focado e borra
            filterChain = `boxblur=luma_radius='40*${t}':luma_power=1,zoompan=z='1.0':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        // =================================================================
        // 4. ELÁSTICO & GRAVIDADE (Física Real)
        // =================================================================

        case 'mov-rubber-band': // Elástico (Boing Boing)
            // Senoide rápida amortecida
            filterChain = `zoompan=z='1.4 + 0.3*sin(on/5)*exp(-on/${totalFrames/3})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'mov-bounce-drop': // Queda com Quique
            // Simula gravidade no eixo Y
            filterChain = `zoompan=z='1.2':x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/3)*abs(cos(on/10))*exp(-on/${totalFrames/2})'${zpDur}`;
            break;

        case 'mov-pop-up': // Pop Up
            // Zoom rápido inicial e parada
            filterChain = `zoompan=z='if(lte(on,15), 1.0+(0.5*on/15), 1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        // =================================================================
        // 5. GLITCH & CAOS (Random & Modulo)
        // =================================================================

        case 'mov-glitch-snap': // Cortes Rápidos de Zoom
            // Zoom alterna bruscamente entre 1.0 e 1.6 a cada 5 frames
            filterChain = `zoompan=z='if(eq(mod(on,5),0), 1.6, 1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'mov-jitter-x': // Tremelique Horizontal
            filterChain = `zoompan=z='1.2':x='iw/2-(iw/zoom/2) + (iw/20)*sin(on*50)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'earthquake': // Terremoto Total
            // Vibração caótica em X e Y
            filterChain = `zoompan=z='1.1':x='iw/2-(iw/zoom/2) + (random(1)-0.5)*(iw/10)':y='ih/2-(ih/zoom/2) + (random(1)-0.5)*(ih/10)'${zpDur}`;
            break;

        // =================================================================
        // 6. CÂMERA DE MÃO (Handheld Realista)
        // =================================================================

        case 'handheld-1': 
        case 'mov-walk':
            // Soma de senos para movimento orgânico
            filterChain = `zoompan=z='1.2':x='iw/2-(iw/zoom/2) + (iw/40)*sin(on/20)':y='ih/2-(ih/zoom/2) + (ih/40)*cos(on/25)'${zpDur}`;
            break;

        // PADRÃO
        case 'static':
        case 'kenBurns':
        default:
            // Movimento sutil padrão
            filterChain = `zoompan=z='1.0+0.15*${t}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;
    }

    return `${preProcess},${filterChain},${postProcess}`;
}
