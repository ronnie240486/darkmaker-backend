
// Configurações do Filtro de Movimento
const W = 1280;
const H = 720;
const FRAMES_BUFFER = 900; // Increased buffer (30s @ 30fps) to prevent frame drop issues

export function getMovementFilter(type) {
    // 1. Pré-processamento: Garante que a imagem preencha 1280x720 e tenha Pixel Ratio 1:1
    const preProcess = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
    
    // 2. Pós-processamento CRÍTICO: 
    // setpts=PTS-STARTPTS -> Reseta o relógio do vídeo (corrige tela preta/congelada)
    // fps=30 -> Garante framerate constante
    // format=yuv420p -> Garante compatibilidade de cor
    const postProcess = `setpts=PTS-STARTPTS,fps=30,format=yuv420p`;

    let effect = "";

    switch(type) {
        case 'zoom-in': 
            // Suavizado: Zoom de 1.0 a 1.25 (menos agressivo que 1.5)
            effect = `zoompan=z='min(zoom+0.0008,1.25)':d=${FRAMES_BUFFER}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}`;
            break;
        case 'zoom-out':
            // Suavizado
            effect = `zoompan=z='if(lte(zoom,1.0),1.25,max(1.001,zoom-0.0008))':d=${FRAMES_BUFFER}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}`;
            break;
        case 'pan-left':
            effect = `zoompan=z=1.1:x='if(lte(on,1),(iw-iw/zoom)/2,x-0.8)':y='(ih-ih/zoom)/2':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'pan-right':
            effect = `zoompan=z=1.1:x='if(lte(on,1),(iw-iw/zoom)/2,x+0.8)':y='(ih-ih/zoom)/2':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'tilt-up':
            effect = `zoompan=z=1.1:x='(iw-iw/zoom)/2':y='if(lte(on,1),(ih-ih/zoom)/2,y-0.8)':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'tilt-down':
            effect = `zoompan=z=1.1:x='(iw-iw/zoom)/2':y='if(lte(on,1),(ih-ih/zoom)/2,y+0.8)':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'handheld':
            // CORREÇÃO CRÍTICA DE TREMOR:
            // Reduzido multiplicador de seno (frequência) de 2 para 0.5
            // Reduzida amplitude de 15 para 3 pixels
            effect = `zoompan=z=1.05:x='(iw-iw/zoom)/2+sin(time*0.5)*3':y='(ih-ih/zoom)/2+cos(time*0.4)*3':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'static':
        default:
            // Retorna apenas a normalização sem zoompan
            return `${preProcess},fps=30,format=yuv420p`;
    }

    return `${preProcess},${effect},${postProcess}`;
}
