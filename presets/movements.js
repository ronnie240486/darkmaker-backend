
// Configurações do Filtro de Movimento
const W = 1280;
const H = 720;
const FRAMES_BUFFER = 750; // Buffer de quadros para evitar congelamento (25s @ 30fps)

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
            effect = `zoompan=z='min(zoom+0.0015,1.5)':d=${FRAMES_BUFFER}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}`;
            break;
        case 'zoom-out':
            effect = `zoompan=z='if(lte(zoom,1.0),1.5,max(1.001,zoom-0.0015))':d=${FRAMES_BUFFER}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}`;
            break;
        case 'pan-left':
            effect = `zoompan=z=1.2:x='if(lte(on,1),(iw-iw/zoom)/2,x-1.0)':y='(ih-ih/zoom)/2':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'pan-right':
            effect = `zoompan=z=1.2:x='if(lte(on,1),(iw-iw/zoom)/2,x+1.0)':y='(ih-ih/zoom)/2':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'tilt-up':
            effect = `zoompan=z=1.2:x='(iw-iw/zoom)/2':y='if(lte(on,1),(ih-ih/zoom)/2,y-1.0)':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'tilt-down':
            effect = `zoompan=z=1.2:x='(iw-iw/zoom)/2':y='if(lte(on,1),(ih-ih/zoom)/2,y+1.0)':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'handheld':
            // Simula movimento de mão tremida com seno/cosseno
            effect = `zoompan=z=1.1:x='(iw-iw/zoom)/2+sin(time*2)*15':y='(ih-ih/zoom)/2+cos(time*3)*15':d=${FRAMES_BUFFER}:s=${W}x${H}`;
            break;
        case 'static':
        default:
            // Retorna apenas a normalização sem zoompan
            return `${preProcess},fps=30,format=yuv420p`;
    }

    return `${preProcess},${effect},${postProcess}`;
}
