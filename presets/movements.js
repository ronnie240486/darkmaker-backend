

// presets/movements.js

export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720, config = {}) {
    const d = parseFloat(durationSec) || 5;
    const fps = 30;
    const totalFrames = Math.ceil(d * fps);
    
    // Fator de Super-Sampling (5x) para suavidade extrema
    const ssW = targetW * 5;
    const ssH = targetH * 5;
    
    const base = `:d=${totalFrames}:s=${ssW}x${ssH}:fps=${fps}`; 
    const center = "x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2)";
    const speed = parseFloat(config.speed || 1.0);

    const preProcess = `scale=${ssW}:${ssH}:force_original_aspect_ratio=increase,crop=${ssW}:${ssH},setsar=1`;
    const postProcess = `scale=${targetW}:${targetH}:flags=lanczos,setpts=PTS-STARTPTS,fps=${fps},format=yuv420p`;

    let effect = "";

    switch (moveId) {
        // --- ESTÁTICOS & SUAVES ---
        case 'static':
            effect = `zoompan=z=1.0:x=0:y=0${base}`;
            break;
        case 'kenBurns':
            effect = `zoompan=z='min(1.0+(0.0003*on),1.15)':${center}${base}`;
            break;
        case 'mov-3d-float':
            effect = `zoompan=z='1.05+0.02*sin(on*0.01)':x='iw/2-(iw/zoom/2)+5*sin(on*0.02)':y='ih/2-(ih/zoom/2)+5*cos(on*0.02)'${base}`;
            break;
        case 'mov-tilt-up-slow':
            effect = `zoompan=z=1.1:y='(ih-ih/zoom)*(on/${totalFrames})':x='iw/2-(iw/zoom/2)'${base}`;
            break;
        case 'mov-tilt-down-slow':
            effect = `zoompan=z=1.1:y='(ih-ih/zoom)*(1-(on/${totalFrames}))':x='iw/2-(iw/zoom/2)'${base}`;
            break;

        // --- ZOOM DINÂMICO ---
        case 'zoom-in':
            effect = `zoompan=z='min(zoom+0.001*${speed},1.5)':${center}${base}`;
            break;
        case 'zoom-out':
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
            // Twist requires rotation, but standard zoompan only does x/y/z. 
            // We simulate twist with 'a' parameter if supported or fallback to dynamic zoom
            effect = `zoompan=z='1.0+0.002*on':${center}${base}`; 
            break;
        case 'mov-zoom-wobble':
            effect = `zoompan=z='1.1+0.05*sin(on*0.1)':x='iw/2-(iw/zoom/2)+10*sin(on*0.2)':y='ih/2-(ih/zoom/2)+10*cos(on*0.2)'${base}`;
            break;
        case 'mov-scale-pulse':
            effect = `zoompan=z='1.2+0.1*cos(on*0.2)':${center}${base}`;
            break;
        case 'mov-spiral-out':
             effect = `zoompan=z='max(1.5-0.002*on,1.0)':x='iw/2-(iw/zoom/2)+20*sin(on*0.1)':y='ih/2-(ih/zoom/2)+20*cos(on*0.1)'${base}`;
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
        case 'mov-pan-slow-u':
            effect = `zoompan=z=1.2:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(on/${totalFrames})'${base}`;
            break;
        case 'mov-pan-slow-d':
            effect = `zoompan=z=1.2:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-(on/${totalFrames}))'${base}`;
            break;
        case 'mov-pan-fast-l':
            effect = `zoompan=z=1.2:x='(iw-iw/zoom)*(on/${totalFrames}*2)':y='ih/2-(ih/zoom/2)'${base}`;
            break;
        case 'mov-pan-fast-r':
            effect = `zoompan=z=1.2:x='(iw-iw/zoom)*(1-(on/${totalFrames}*2))':y='ih/2-(ih/zoom/2)'${base}`;
            break;
        case 'mov-pan-diag-tl':
        case 'mov-diag-tl':
            effect = `zoompan=z=1.2:x='(iw-iw/zoom)*(on/${totalFrames})':y='(ih-ih/zoom)*(on/${totalFrames})'${base}`;
            break;
        case 'mov-pan-diag-br':
        case 'mov-diag-tr':
            effect = `zoompan=z=1.2:x='(iw-iw/zoom)*(1-(on/${totalFrames}))':y='(ih-ih/zoom)*(1-(on/${totalFrames}))'${base}`;
            break;

        // --- REALISMO & CAOS ---
        case 'handheld-1':
            effect = `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+8*sin(on*0.5)':y='ih/2-(ih/zoom/2)+8*cos(on*0.7)'${base}`;
            break;
        case 'handheld-2':
            effect = `zoompan=z=1.15:x='iw/2-(iw/zoom/2)+15*sin(on*0.3)+5*random(1)':y='ih/2-(ih/zoom/2)+15*cos(on*0.4)+5*random(2)'${base}`;
            break;
        case 'earthquake':
            effect = `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+25*sin(on*0.7)':y='ih/2-(ih/zoom/2)+25*cos(on*0.7)'${base}`;
            break;
        case 'mov-jitter-x':
            effect = `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+10*random(1)':y='ih/2-(ih/zoom/2)'${base}`;
            break;
        case 'mov-walk':
            effect = `zoompan=z=1.1:y='ih/2-(ih/zoom/2)+15*abs(sin(on*0.15))':x='iw/2-(iw/zoom/2)+5*sin(on*0.07)'${base}`;
            break;
        case 'mov-run':
            effect = `zoompan=z=1.1:y='ih/2-(iw/zoom/2)+25*abs(sin(on*0.4))':x='iw/2-(iw/zoom/2)+10*sin(on*0.2)'${base}`;
            break;
        case 'mov-vibrate':
            effect = `zoompan=z=1.05:x='iw/2-(iw/zoom/2)+2*random(0)':y='ih/2-(ih/zoom/2)+2*random(1)'${base}`;
            break;

        // --- 3D, GLITCH & EFEITOS ---
        case 'mov-3d-spin-axis':
            // Simula spin com pan circular rápido
            effect = `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+100*sin(on*0.1)':y='ih/2-(ih/zoom/2)+100*cos(on*0.1)'${base}`;
            break;
        case 'mov-3d-flip-x':
            // Flip não suportado nativamente no zoompan sem filtros complexos, fallback para zoom rápido
            effect = `zoompan=z='1+0.5*abs(sin(on*0.1))':${center}${base}`;
            break;
        case 'mov-3d-flip-y':
            effect = `zoompan=z='1+0.5*abs(cos(on*0.1))':${center}${base}`;
            break;
        case 'mov-3d-swing-l':
        case 'mov-3d-swing-r':
            effect = `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+50*sin(on*0.05)':y='ih/2-(ih/zoom/2)'${base}`;
            break;
        case 'mov-3d-roll':
             // Roll requer rotação, simulado com movimento circular
             effect = `zoompan=z=1.3:x='iw/2-(iw/zoom/2)+50*sin(on*0.1)':y='ih/2-(ih/zoom/2)+50*cos(on*0.1)'${base}`;
             break;

        case 'mov-glitch-snap':
            effect = `zoompan=z='if(between(mod(on,20),0,2),1.4,1.1)':${center}${base}`;
            break;
        case 'mov-glitch-skid':
            effect = `zoompan=z=1.1:x='if(between(mod(on,10),0,1),iw/2-(iw/zoom/2)+100,iw/2-(iw/zoom/2))':y='ih/2-(ih/zoom/2)'${base}`;
            break;
        case 'mov-shake-violent':
            effect = `zoompan=z=1.3:x='iw/2-(iw/zoom/2)+40*random(1)':y='ih/2-(ih/zoom/2)+40*random(2)'${base}`;
            break;
        case 'mov-rgb-shift-move':
            effect = `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+10*sin(on*0.5)'${base},rgbashift=rh=10:bv=10`;
            break;

        case 'mov-blur-in':
            effect = `zoompan=z=1.1:${center}${base},boxblur=lp='min(on,20)'`;
            break;
        case 'mov-blur-out':
            effect = `zoompan=z=1.1:${center}${base},boxblur=lp='max(20-on,0)'`;
            break;
        case 'mov-blur-pulse':
            effect = `zoompan=z=1.1:${center}${base},boxblur=lp='5*abs(sin(on*0.1))'`;
            break;
        case 'mov-tilt-shift':
             // Aproximação de tilt shift com blur nas bordas (via vignette ou similar não é fácil aqui, usa blur simples)
             effect = `zoompan=z=1.0:${center}${base},boxblur=lp=5`; 
             break;

        // --- ELÁSTICO ---
        case 'mov-rubber-band':
            effect = `zoompan=z='1.0+0.1*abs(sin(on*0.2))':${center}${base}`;
            break;
        case 'mov-jelly-wobble':
            effect = `zoompan=z='1.0+0.05*sin(on*0.3)':x='iw/2-(iw/zoom/2)+10*sin(on*0.5)':y='ih/2-(ih/zoom/2)+10*cos(on*0.5)'${base}`;
            break;
        case 'mov-pop-up':
            effect = `zoompan=z='min(1.0+(on*0.1),1.2)':${center}${base}`;
            break;
        case 'mov-bounce-drop':
            effect = `zoompan=z='max(1.5-(on*0.1),1.0)':${center}${base}`;
            break;

        default:
            // Fallback para Ken Burns linear
            effect = `zoompan=z='min(1.0+(0.0003*on),1.15)':${center}${base}`;
    }

    return `${preProcess},${effect},${postProcess}`;
}
