
// Configurações do Filtro de Movimento
const W = 1280;
const H = 720;
// Aumentamos o buffer para garantir que não falte frames em clipes longos
const FRAMES_BUFFER = 900; 

export function getMovementFilter(type) {
    // 1. Pré-processamento: Garante que a imagem preencha 1280x720
    const preProcess = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
    
    // 2. Pós-processamento: Reseta timestamps e força formato
    const postProcess = `setpts=PTS-STARTPTS,fps=30,format=yuv420p`;

    let effect = "";

    // NOTA: 'on' é o número do frame de saída. Usamos ele para cálculos suaves.
    switch(type) {
        case 'zoom-in': 
            // V3: Zoom Ultra Lento Cinemático (0.0004/frame)
            // Começa em 1.0 e vai até ~1.15 em 5 segundos. Sem tremedeira.
            effect = `zoompan=z='min(zoom+0.0004,1.2)':d=${FRAMES_BUFFER}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}`;
            break;
        case 'zoom-out':
            // V3: Começa em 1.2 e reduz suavemente
            effect = `zoompan=z='if(lte(zoom,1.0),1.2,max(1.001,zoom-0.0004))':d=${FRAMES_BUFFER}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}`;
            break;
        case 'pan-left':
            // Zoom fixo de 1.1, move o eixo X da direita para a esquerda
            effect = `zoompan=z=1.1:x='if(lte(on,1),(iw-iw/zoom)/2,x-0.5)':y='(ih-ih/zoom)/2':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'pan-right':
            // Zoom fixo de 1.1, move o eixo X da esquerda para a direita
            effect = `zoompan=z=1.1:x='if(lte(on,1),(iw-iw/zoom)/2,x+0.5)':y='(ih-ih/zoom)/2':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'tilt-up':
            effect = `zoompan=z=1.1:x='(iw-iw/zoom)/2':y='if(lte(on,1),(ih-ih/zoom)/2,y-0.5)':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'tilt-down':
            effect = `zoompan=z=1.1:x='(iw-iw/zoom)/2':y='if(lte(on,1),(ih-ih/zoom)/2,y+0.5)':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'handheld':
            // CORREÇÃO: Zoom fixo em 1.15 para dar margem.
            // Oscilação suave usando seno e cosseno baseados no frame atual (on).
            // A divisão por 40 e 55 controla a velocidade da oscilação (frequência).
            // A multiplicação por 6 e 4 controla a distância do movimento (amplitude).
            effect = `zoompan=z=1.15:x='(iw-iw/zoom)/2 + (sin(on/40)*6)':y='(ih-ih/zoom)/2 + (cos(on/55)*4)':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'static':
        default:
            return `${preProcess},fps=30,format=yuv420p`;
    }

    return `${preProcess},${effect},${postProcess}`;
}
