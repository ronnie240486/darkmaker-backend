
// presets/movements.js

export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720, config = {}) {
    const d = parseFloat(durationSec) || 5;
    const fps = 24; 
    const totalFrames = Math.ceil(d * fps);
    
    const ssW = targetW; 
    const ssH = targetH;
    
    const base = `:d=${totalFrames}:s=${ssW}x${ssH}:fps=${fps}`; 
    const center = "x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2)";
    const speed = parseFloat(config.speed || 1.0);

    const preProcess = `scale=${ssW}:${ssH}:force_original_aspect_ratio=increase,crop=${ssW}:${ssH},setsar=1`;
    const postProcess = `scale=${targetW}:${targetH}:flags=bilinear,setpts=PTS-STARTPTS,fps=${fps},format=yuv420p`;

    let effect = "";
    let extraFilter = "";

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
        case 'mov-zoom-wobble':
            effect = `zoompan=z='1.1+0.03*sin(on*0.2)':x='iw/2-(iw/zoom/2)+10*cos(on*0.1)':y='ih/2-(ih/zoom/2)+10*sin(on*0.1)'${base}`;
            break;

        // --- PANORÂMICAS ---
        case 'mov-pan-slow-l':
            effect = `zoompan=z=1.2:x='(iw-iw/zoom)*(on/${totalFrames})':y='ih/2-(ih/zoom/2)'${base}`;
            break;
        case 'mov-pan-slow-r':
            effect = `zoompan=z=1.2:x='(iw-iw/zoom)*(1-(on/${totalFrames}))':y='ih/2-(ih/zoom/2)'${base}`;
            break;
        case 'mov-pan-fast-l':
            effect = `zoompan=z=1.3:x='(iw-iw/zoom)*(on/(${totalFrames}/2))':y='ih/2-(ih/zoom/2)'${base}`;
            break;
        case 'mov-pan-fast-r':
            effect = `zoompan=z=1.3:x='(iw-iw/zoom)*(1-(on/(${totalFrames}/2)))':y='ih/2-(ih/zoom/2)'${base}`;
            break;

        // --- 3D & ROTAÇÃO ---
        case 'mov-3d-spin-axis':
            effect = `zoompan=z=1.1:${center}${base}`;
            extraFilter = `,rotate='0.05*on'`;
            break;
        case 'mov-3d-flip-x':
            effect = `zoompan=z=1.1:${center}${base}`;
            extraFilter = `,vflip,rotate='PI*sin(on/10)'`; // Simulação rudimentar de flip
            break;
        case 'mov-3d-flip-y':
            effect = `zoompan=z=1.1:${center}${base}`;
            extraFilter = `,hflip,rotate='PI*sin(on/10)'`;
            break;
        case 'mov-3d-swing-l':
            effect = `zoompan=z=1.1:${center}${base}`;
            extraFilter = `,rotate='0.1*sin(on*0.1)'`;
            break;
        case 'mov-3d-roll':
            effect = `zoompan=z=1.2:${center}${base}`;
            extraFilter = `,rotate='0.2*sin(on*0.05)'`;
            break;

        // --- GLITCH & CAOS ---
        case 'mov-glitch-snap':
            effect = `zoompan=z='if(between(mod(on,15),0,2),1.5,1.1)':x='if(between(mod(on,15),0,2),iw/3,iw/2-iw/zoom/2)':y='ih/2-ih/zoom/2'${base}`;
            break;
        case 'mov-glitch-skid':
            effect = `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+if(between(mod(on,10),0,1),50,0)':y='ih/2-ih/zoom/2'${base}`;
            break;
        case 'mov-shake-violent':
            effect = `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+20*random(0)-10':y='ih/2-(ih/zoom/2)+20*random(1)-10'${base}`;
            break;
        case 'mov-rgb-shift-move':
            effect = `zoompan=z=1.1:${center}${base}`;
            extraFilter = `,rgbashift=rh=5:bv=-5`;
            break;
        case 'mov-vibrate':
            effect = `zoompan=z=1.05:x='iw/2-(iw/zoom/2)+2*random(0)':y='ih/2-(ih/zoom/2)+2*random(1)'${base}`;
            break;

        // --- FOCO & BLUR ---
        case 'mov-blur-in':
            effect = `zoompan=z=1.1:${center}${base}`;
            extraFilter = `,boxblur=lp='min(on,20)'`;
            break;
        case 'mov-blur-out':
            effect = `zoompan=z=1.1:${center}${base}`;
            extraFilter = `,boxblur=lp='max(20-on,0)'`;
            break;
        case 'mov-blur-pulse':
            effect = `zoompan=z=1.1:${center}${base}`;
            extraFilter = `,boxblur=lp='10*abs(sin(on*0.1))'`;
            break;
        case 'mov-tilt-shift':
            effect = `zoompan=z=1.1:${center}${base}`;
            extraFilter = `,boxblur=lp=10:lps='if(between(y,ih*0.4,ih*0.6),0,1)'`;
            break;

        // --- ELÁSTICO & DIVERTIDO ---
        case 'mov-rubber-band':
            effect = `zoompan=z='1.0+0.2*abs(sin(on*0.1))':${center}${base}`;
            break;
        case 'mov-jelly-wobble':
            effect = `zoompan=z='1.1+0.1*sin(on*0.15)':x='iw/2-(iw/zoom/2)+15*sin(on*0.2)':y='ih/2-(ih/zoom/2)+15*cos(on*0.2)'${base}`;
            break;
        case 'mov-pop-up':
            effect = `zoompan=z='if(between(on,0,10),on/10,1.1)':${center}${base}`;
            break;
        case 'mov-bounce-drop':
            effect = `zoompan=z=1.1:y='if(between(on,0,15),-ih+ih*(on/15),ih/2-ih/zoom/2)':x='iw/2-iw/zoom/2'${base}`;
            break;

        default:
            effect = `zoompan=z='min(1.0+(0.0003*on),1.15)':${center}${base}`;
    }

    return `${preProcess},${effect}${extraFilter},${postProcess}`;
}
