// presets/movements.js

export function getMovementFilter(
    moveId,
    durationSec = 5,
    targetW = 1280,
    targetH = 720,
    config = {}
) {
    const d = parseFloat(durationSec) || 5;
    const fps = 24;
    const totalFrames = Math.ceil(d * fps);

    const ssW = targetW;
    const ssH = targetH;

    const base = `:d=${totalFrames}:s=${ssW}x${ssH}:fps=${fps}`;
    const center = "x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2)";
    const speed = parseFloat(config.speed || 1.0);

    const preProcess =
        `scale=${ssW}:${ssH}:force_original_aspect_ratio=increase,` +
        `crop=${ssW}:${ssH},setsar=1`;

    const postProcess =
        `scale=${targetW}:${targetH}:flags=bilinear,` +
        `setpts=PTS-STARTPTS,fps=${fps},format=yuv420p`;

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
            effect =
                `zoompan=` +
                `z='1.05+0.02*sin(on*0.01)':` +
                `x='iw/2-(iw/zoom/2)+5*sin(on*0.02)':` +
                `y='ih/2-(ih/zoom/2)+5*cos(on*0.02)'${base}`;
            break;

        case 'mov-tilt-up-slow':
            effect =
                `zoompan=z=1.1:` +
                `y='(ih-ih/zoom)*(on/${totalFrames})':` +
                `x='iw/2-(iw/zoom/2)'${base}`;
            break;

        case 'mov-tilt-down-slow':
            effect =
                `zoompan=z=1.1:` +
                `y='(ih-ih/zoom)*(1-(on/${totalFrames}))':` +
                `x='iw/2-(iw/zoom/2)'${base}`;
            break;

        // --- ZOOM DINÂMICO ---
        case 'zoom-in':
            effect =
                `zoompan=z='min(zoom+0.001*${speed},1.5)':${center}${base}`;
            break;

        case 'zoom-out':
            effect =
                `zoompan=z='max(1.5-0.001*${speed}*on,1.0)':${center}${base}`;
            break;

        case 'mov-zoom-crash-in':
            effect =
                `zoompan=z='min(zoom+0.008*${speed},2.0)':${center}${base}`;
            break;

        case 'mov-zoom-crash-out':
            effect =
                `zoompan=z='max(2.0-0.008*${speed}*on,1.0)':${center}${base}`;
            break;

        case 'mov-zoom-bounce-in':
            effect =
                `zoompan=z='1.2+0.1*abs(sin(on*0.1))':${center}${base}`;
            break;

        case 'mov-zoom-pulse-slow':
            effect =
                `zoompan=z='1.1+0.05*sin(on*0.05)':${center}${base}`;
            break;

        case 'mov-dolly-vertigo':
            effect =
                `zoompan=z='1.0+0.003*on':${center}${base}`;
            break;

        case 'mov-zoom-wobble':
            effect =
                `zoompan=` +
                `z='1.1+0.03*sin(on*0.2)':` +
                `x='iw/2-(iw/zoom/2)+10*cos(on*0.1)':` +
                `y='ih/2-(ih/zoom/2)+10*sin(on*0.1)'${base}`;
            break;

        // --- PANORÂMICAS ---
        case 'mov-pan-slow-l':
            effect =
                `zoompan=z=1.2:` +
                `x='(iw-iw/zoom)*(on/${totalFrames})':` +
                `y='ih/2-(ih/zoom/2)'${base}`;
            break;

        case 'mov-pan-slow-r':
            effect =
                `zoompan=z=1.2:` +
                `x='(iw-iw/zoom)*(1-(on/${totalFrames}))':` +
                `y='ih/2-(ih/zoom/2)'${base}`;
            break;

        // --- 3D & ROTAÇÃO ---
        case 'mov-3d-spin-axis':
            effect = `zoompan=z=1.1:${center}${base}`;
            extraFilter = `,rotate='0.05*on'`;
            break;

        case 'mov-3d-roll':
            effect = `zoompan=z=1.2:${center}${base}`;
            extraFilter = `,rotate='0.2*sin(on*0.05)'`;
            break;

        // --- GLITCH ---
        case 'mov-shake-violent':
            effect =
                `zoompan=z=1.2:` +
                `x='iw/2-(iw/zoom/2)+20*random(0)-10':` +
                `y='ih/2-(ih/zoom/2)+20*random(1)-10'${base}`;
            break;

        // --- FOCO & BLUR (CORRIGIDO) ---
        case 'mov-blur-in':
            effect =
                `zoompan=z='min(1.0+(0.001*on),1.1)':${center}${base}`;
            extraFilter =
                `,gblur=sigma='20*(1-n/${totalFrames})':steps=2:eval=frame`;
            break;

        case 'mov-blur-out':
            effect =
                `zoompan=z='min(1.0+(0.001*on),1.1)':${center}${base}`;
            extraFilter =
                `,gblur=sigma='20*(n/${totalFrames})':steps=2:eval=frame`;
            break;

        case 'mov-blur-pulse':
            effect =
                `zoompan=z='1.05+0.01*sin(on*0.05)':${center}${base}`;
            extraFilter =
                `,gblur=sigma='10*abs(sin(n/${fps}*3))':steps=2:eval=frame`;
            break;

        // --- DEFAULT ---
        default:
            effect =
                `zoompan=z='min(1.0+(0.0003*on),1.15)':${center}${base}`;
    }

    return `${preProcess},${effect}${extraFilter},${postProcess}`;
}
