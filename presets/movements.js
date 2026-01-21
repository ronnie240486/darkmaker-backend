
// presets/movements.js

export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720, config = {}) {
    const d = parseFloat(durationSec) || 5;
    const fps = 30;
    const totalFrames = Math.ceil(d * fps);
    
    // Fator de Super-Sampling Aumentado para 5x para suavidade extrema (Anti-Aliasing)
    // Reduz o "tremor" de pixel em movimentos lentos.
    const ssW = targetW * 5;
    const ssH = targetH * 5;
    
    const base = `:d=${totalFrames}:s=${ssW}x${ssH}:fps=${fps}`; 
    const center = "x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2)";
    const speed = parseFloat(config.speed || 1.0);

    const preProcess = `scale=${ssW}:${ssH}:force_original_aspect_ratio=increase,crop=${ssW}:${ssH},setsar=1`;
    // Lanczos é essencial para downscaling de qualidade
    const postProcess = `scale=${targetW}:${targetH}:flags=lanczos,setpts=PTS-STARTPTS,fps=${fps},format=yuv420p`;

    let effect = "";

    switch (moveId) {
        // --- ESTÁTICOS & SUAVES (ZERO TREMOR) ---
        case 'static':
            // Completamente travado. Zoom fixo em 1.0.
            effect = `zoompan=z=1.0:x=0:y=0${base}`;
            break;
        case 'kenBurns':
            // Movimento linear ultra suave. Sem aceleração, sem curvas, sem wobble.
            // Zoom suave de 1.0 a 1.15. Pan centralizado.
            effect = `zoompan=z='min(1.0+(0.0003*on),1.15)':${center}${base}`;
            break;
        case 'mov-3d-float':
            // "Flutuar" ainda deve ter um leve movimento, mas suavizado.
            effect = `zoompan=z='1.05+0.02*sin(on*0.01)':x='iw/2-(iw/zoom/2)+5*sin(on*0.02)':y='ih/2-(ih/zoom/2)+5*cos(on*0.02)'${base}`;
            break;
        case 'mov-tilt-up-slow':
            // Movimento vertical linear puro
            effect = `zoompan=z=1.1:y='(ih-ih/zoom)*(on/${totalFrames})':x='iw/2-(iw/zoom/2)'${base}`;
            break;
        case 'mov-tilt-down-slow':
            effect = `zoompan=z=1.1:y='(ih-ih/zoom)*(1-(on/${totalFrames}))':x='iw/2-(iw/zoom/2)'${base}`;
            break;

        // --- ZOOM DINÂMICO (ZERO TREMOR) ---
        case 'zoom-in':
            // Zoom linear puro no centro.
            effect = `zoompan=z='min(zoom+0.001*${speed},1.5)':${center}${base}`;
            break;
        case 'zoom-out':
            // Zoom out linear puro.
            effect = `zoompan=z='max(1.5-0.001*${speed}*on,1.0)':${center}${base}`;
            break;
        case 'mov-zoom-crash-in':
            effect = `zoompan=z='min(zoom+0.008*${speed},2.0)':${center}${base}`;
            break;
        case 'mov-zoom-crash-out':
            effect = `zoompan=z='max(2.0-0.008*${speed}*on,1.0)':${center}${base}`;
            break;
        case 'mov-zoom-bounce-in':
            effect = `zoompan=z='1.2+0.1*abs(sin(on*0.1))':${center}${base}`;
            break;
        case 'mov-zoom-pulse-slow':
            effect = `zoompan=z='1.1+0.05*sin(on*0.05)':${center}${base}`;
            break;
        case 'mov-dolly-vertigo':
            effect = `zoompan=z='1.0+0.003*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${base}`;
            break;
        case 'mov-zoom-twist-in':
            effect = `zoompan=z='1.0+0.001*on':${center}:a='0.05*on'${base}`;
            break;
        case 'mov-scale-pulse':
            effect = `zoompan=z='1.2+0.1*cos(on*0.2)':${center}${base}`;
            break;

        // --- PANORÂMICAS ---
        case 'mov-pan-slow-l':
        case 'pan-left':
            effect = `zoompan=z=1.2:x='(iw-iw/zoom)*(on/${totalFrames})':y='ih/2-(ih/zoom/2)'${base}`;
            break;
        case 'mov-pan-slow-r':
        case 'pan-right':
            effect = `zoompan=z=1.2:x='(iw-iw/zoom)*(1-(on/${totalFrames}))':y='ih/2-(ih/zoom/2)'${base}`;
            break;
        case 'mov-pan-diag-tl':
            effect = `zoompan=z=1.2:x='(iw-iw/zoom)*(on/${totalFrames})':y='(ih-ih/zoom)*(on/${totalFrames})'${base}`;
            break;
        case 'mov-pan-diag-br':
            effect = `zoompan=z=1.2:x='(iw-iw/zoom)*(1-(on/${totalFrames}))':y='(ih-ih/zoom)*(1-(on/${totalFrames}))'${base}`;
            break;

        // --- REALISMO & CAOS ---
        case 'handheld-1':
            effect = `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+8*random(0)':y='ih/2-(ih/zoom/2)+8*random(1)'${base}`;
            break;
        case 'earthquake':
            effect = `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+25*sin(on*0.7)':y='ih/2-(ih/zoom/2)+25*cos(on*0.7)'${base}`;
            break;
        case 'mov-walk':
            effect = `zoompan=z=1.1:y='ih/2-(ih/zoom/2)+15*abs(sin(on*0.15))':x='iw/2-(iw/zoom/2)+5*sin(on*0.07)'${base}`;
            break;
        case 'mov-vibrate':
            effect = `zoompan=z=1.05:x='iw/2-(iw/zoom/2)+2*random(0)':y='ih/2-(ih/zoom/2)+2*random(1)'${base}`;
            break;

        // --- 3D & GLITCH ---
        case 'mov-3d-spin-axis':
            effect = `zoompan=z=1.1:${center}:a='on*0.02'${base}`;
            break;
        case 'mov-glitch-snap':
            effect = `zoompan=z='if(between(mod(on,20),0,2),1.4,1.1)':${center}${base}`;
            break;
        case 'mov-rgb-shift-move':
            effect = `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+10*sin(on*0.5)'${base}`;
            break;

        // --- FOCO & BLUR ---
        case 'mov-blur-in':
            effect = `zoompan=z=1.1:${center}${base},boxblur=lp='min(on,20)'`;
            break;
        case 'mov-blur-out':
            effect = `zoompan=z=1.1:${center}${base},boxblur=lp='max(20-on,0)'`;
            break;

        default:
            // Fallback para Ken Burns linear
            effect = `zoompan=z='min(1.0+(0.0003*on),1.15)':${center}${base}`;
    }

    return `${preProcess},${effect},${postProcess}`;
}
