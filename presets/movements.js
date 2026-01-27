// presets/movements.js
// 100% compatível com ffmpeg-static

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
        `setpts=PTS-STARTPTS,format=yuv420p`;

    let effect = "";
    let extraFilter = "";

    switch (moveId) {

        // --- ESTÁTICOS ---
        case 'static':
            effect = `zoompan=z=1.0:x=0:y=0${base}`;
            break;

        case 'kenBurns':
            effect = `zoompan=z='min(1.0+(0.0003*on),1.15)':${center}${base}`;
            break;

        // --- ZOOM ---
        case 'zoom-in':
            effect =
                `zoompan=z='min(zoom+0.001*${speed},1.5)':${center}${base}`;
            break;

        case 'zoom-out':
            effect =
                `zoompan=z='max(1.5-0.001*${speed}*on,1.0)':${center}${base}`;
            break;

        // --- PAN ---
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

        // --- SHAKE ---
        case 'mov-shake-violent':
            effect =
                `zoompan=z=1.2:` +
                `x='iw/2-(iw/zoom/2)+20*rand()-10':` +
                `y='ih/2-(ih/zoom/2)+20*rand()-10'${base}`;
            break;

        // --- BLUR (VERSÃO SEGURA COM GBLUR) ---
        case 'mov-blur-in':
            effect =
                `zoompan=z='min(1.0+(0.001*on),1.1)':${center}${base}`;
            extraFilter =
                `,gblur=sigma='20*(1-(t/${d}))'`;
            break;

        case 'mov-blur-out':
            effect =
                `zoompan=z='min(1.0+(0.001*on),1.1)':${center}${base}`;
            extraFilter =
                `,gblur=sigma='20*(t/${d})'`;
            break;

        case 'mov-blur-pulse':
            effect =
                `zoompan=z='1.05+0.01*sin(on*0.05)':${center}${base}`;
            extraFilter =
                `,gblur=sigma='10*abs(sin(t*3))'`;
            break;

        default:
            effect =
                `zoompan=z='min(1.0+(0.0003*on),1.15)':${center}${base}`;
    }

    return `${preProcess},${effect}${extraFilter},${postProcess}`;
}
