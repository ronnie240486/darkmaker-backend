
// Configurações do Filtro de Movimento
const W = 1280;
const H = 720;
// Buffer aumentado para garantir suavidade em 60fps internos
const FRAMES_BUFFER = 900; 

export function getMovementFilter(moveId, durationSec = 5, isImage = true, config = {}) {
    const d = parseFloat(durationSec) || 5;
    const totalFrames = Math.ceil(d * 30);
    const uid = Math.floor(Math.random() * 1000000);
    
    // Configuração base: 8K interno para super-sampling (evita tremedeira no zoom lento)
    const base = `:d=1:s=7680x4320:fps=60`; 
    
    // Helpers
    const esc = (s) => s.replace(/,/g, '\\,');
    const center = "x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2)";
    const speed = parseFloat(config.speed || 1.0);

    // 1. Pré-processamento: Garante que a imagem preencha 1280x720 antes do zoompan
    const preProcess = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
    
    // 2. Pós-processamento: Reseta timestamps e força formato
    const postProcess = `setpts=PTS-STARTPTS,fps=30,format=yuv420p`;

    // Helper para Blur com Zoom (usado em mov-blur-*)
    const blurDuration = Math.min(d, 8.0) / speed; 
    const blurWithZoom = (alphaFilter, zoomExpr = `(1.0+(0.1*${speed}*on/${totalFrames}))`) => {
        // Zoompan gera o stream, split divide, um lado aplica blur, overlay junta com fade
        return `zoompan=z=${esc(zoomExpr)}:${center}${base},split=2[main${uid}][to_blur${uid}];[to_blur${uid}]boxblur=40:5,format=yuva420p,${alphaFilter}[blurred${uid}];[main${uid}][blurred${uid}]overlay=x=0:y=0:shortest=1`;
    };

    let effect = "";

    switch (moveId) {
        // === 0. BLUR & FOCO ===
        case 'mov-blur-in':
            // Começa desfocado e foca
            effect = blurWithZoom(`fade=t=out:st=0:d=${blurDuration}:alpha=1`);
            break;
        case 'mov-blur-out':
            // Começa focado e desfoca no final
            const startTime = Math.max(0, d - blurDuration);
            effect = blurWithZoom(`fade=t=in:st=${startTime}:d=${blurDuration}:alpha=1`);
            break;
        case 'mov-blur-pulse':
            effect = blurWithZoom(`geq=a='128*(1+sin(T*3*${speed}))'`);
            break;
        case 'mov-blur-zoom':
             effect = blurWithZoom(`fade=t=out:st=0:d=${blurDuration}:alpha=1`, `min(1.0+(on*0.8*${speed}/${totalFrames}),1.5)`);
            break;
        case 'mov-blur-motion':
             effect = `boxblur=luma_radius=${15*speed}:luma_power=2`;
             break;

        // === 1. CINEMATIC PANS (Matemática Suave) ===
        case 'mov-pan-slow-l': 
        case 'pan-left':
            effect = `zoompan=z=${1.1 + (0.1 * speed)}:x=${esc(`(iw-iw/zoom)*(on/(${totalFrames}))`)}:y=ih/2-(ih/zoom/2)${base}`;
            break;
        case 'mov-pan-slow-r': 
        case 'pan-right':
            effect = `zoompan=z=${1.1 + (0.1 * speed)}:x=${esc(`(iw-iw/zoom)*(1-(on/(${totalFrames})))`)}:y=ih/2-(ih/zoom/2)${base}`;
            break;
        case 'mov-pan-slow-u': 
        case 'tilt-up':
            effect = `zoompan=z=${1.1 + (0.1 * speed)}:x=iw/2-(iw/zoom/2):y=${esc(`(ih-ih/zoom)*(1-(on/(${totalFrames})))`)}${base}`;
            break;
        case 'mov-pan-slow-d': 
        case 'tilt-down':
            effect = `zoompan=z=${1.1 + (0.1 * speed)}:x=iw/2-(iw/zoom/2):y=${esc(`(ih-ih/zoom)*(on/(${totalFrames}))`)}${base}`;
            break;
        case 'mov-pan-fast-l': 
            effect = `zoompan=z=${1.3 + (0.2 * speed)}:x=${esc(`(iw-iw/zoom)*(on/(${totalFrames}))`)}:y=ih/2-(ih/zoom/2)${base}`;
            break;
        case 'mov-pan-fast-r': 
            effect = `zoompan=z=${1.3 + (0.2 * speed)}:x=${esc(`(iw-iw/zoom)*(1-(on/(${totalFrames})))`)}:y=ih/2-(ih/zoom/2)${base}`;
            break;
        case 'mov-pan-diag-tl': 
            effect = `zoompan=z=${1.2 + (0.1 * speed)}:x=${esc(`(iw-iw/zoom)*(on/(${totalFrames}))`)}:y=${esc(`(ih-ih/zoom)*(on/(${totalFrames}))`)}${base}`;
            break;
        case 'mov-pan-diag-tr': 
            effect = `zoompan=z=${1.2 + (0.1 * speed)}:x=${esc(`(iw-iw/zoom)*(1-(on/(${totalFrames})))`)}:y=${esc(`(ih-ih/zoom)*(on/(${totalFrames}))`)}${base}`;
            break;

        // === 2. DYNAMIC ZOOMS ===
        case 'mov-zoom-crash-in': 
        case 'zoom-fast-in':
        case 'zoom-in':
            effect = `zoompan=z=${esc(`1.0+(${0.5 * speed}*on/${totalFrames})`)}:${center}${base}`;
            break;
        case 'mov-zoom-crash-out': 
        case 'zoom-out':
            effect = `zoompan=z=${esc(`${1.0 + (0.5 * speed)}-(${0.5 * speed}*on/${totalFrames})`)}:${center}${base}`;
            break;
        case 'mov-zoom-slow-in':
        case 'zoom-slow-in':
        case 'kenBurns':
             effect = `zoompan=z=${esc(`1.0+(${0.2 * speed}*on/${totalFrames})`)}:${center}${base}`;
             break;
        case 'mov-zoom-slow-out':
        case 'zoom-slow-out':
             effect = `zoompan=z=${esc(`${1.0 + (0.2 * speed)}-(${0.2 * speed}*on/${totalFrames})`)}:${center}${base}`;
             break;
        case 'mov-zoom-bounce-in':
        case 'zoom-bounce':
             effect = `zoompan=z=${esc(`1.0+${0.1 * speed}*abs(sin(on*0.1*${speed}))`)}:${center}${base}`;
             break;
        case 'mov-zoom-pulse-slow':
        case 'pulse':
             effect = `zoompan=z=${esc(`1.0+${0.05 * speed}*sin(on*0.05*${speed})`)}:${center}${base}`;
             break;
        case 'mov-dolly-vertigo':
        case 'dolly-zoom':
             effect = `zoompan=z=${esc(`min(1.0+(on*1.0*${speed}/${totalFrames}),2.0)`)}:${center}${base}`;
             break;
        case 'mov-zoom-twist-in':
             effect = `rotate=a=${esc(`0.1*${speed}*t`)}:c=black,zoompan=z=${esc(`min(1.0+(on*1.0*${speed}/${totalFrames}),2.0)`)}:${center}${base}`;
             break;
        case 'mov-zoom-wobble':
             effect = `zoompan=z=${esc(`1.1+0.05*${speed}*sin(on*0.2)`)}:x=${esc(`iw/2-(iw/zoom/2)+10*${speed}*sin(on*0.3)`)}:y=${esc(`ih/2-(ih/zoom/2)+10*${speed}*cos(on*0.4)`)}${base}`;
             break;
        case 'mov-zoom-shake':
             effect = `zoompan=z=1.1:x=${esc(`iw/2-(iw/zoom/2)+(random(1)*20-10)*${speed}`)}:y=${esc(`ih/2-(ih/zoom/2)+(random(1)*20-10)*${speed}`)}${base}`;
             break;

        // === 3. 3D TRANSFORMS (Simulados) ===
        case 'mov-3d-flip-x': 
            effect = `scale=w=${esc(`iw*abs(cos(t*2*${speed}))`)}:h=ih,pad=1280:720:(1280-iw)/2:(720-ih)/2:black`;
            break;
        case 'mov-3d-flip-y':
            effect = `scale=w=iw:h=${esc(`ih*abs(cos(t*2*${speed}))`)}:pad=1280:720:(1280-iw)/2:(720-ih)/2:black`;
            break;
        case 'mov-3d-spin-axis': 
        case 'spin-slow':
            effect = `rotate=${esc(`t*0.5*${speed}`)}:ow=iw:oh=ih:c=black`;
            break;
        case 'mov-3d-swing-l':
        case 'pendulum':
            effect = `rotate=${esc(`sin(t*2*${speed})*0.1*${speed}`)}:ow=iw:oh=ih:c=black`;
            break;
        case 'mov-3d-roll':
            effect = `rotate=${esc(`t*2*${speed}`)}:ow=iw:oh=ih:c=black`;
            break;
        case 'mov-3d-float':
            effect = `zoompan=z=${esc(`1.05+0.02*${speed}*sin(time*${speed})`)}:x=${esc(`iw/2-(iw/zoom/2)+10*${speed}*sin(time*0.5*${speed})`)}:y=${esc(`ih/2-(ih/zoom/2)+10*${speed}*cos(time*0.7*${speed})`)}${base}`;
            break;

        // === 4. GLITCH & CHAOS ===
        case 'mov-glitch-snap':
            effect = `crop=w=${esc(`iw-mod(n,10)*10*${speed}`)}:h=ih:x=${esc(`mod(n,10)*5*${speed}`)}:y=0`;
            break;
        case 'mov-glitch-skid':
             effect = `crop=x=${esc(`random(1)*20*${speed}`)}:y=${esc(`random(1)*20*${speed}`)}:w=iw-20:h=ih-20`;
             break;
        case 'mov-shake-violent':
        case 'shake-hard':
             effect = `zoompan=z=1.2:x=${esc(`iw/2-(iw/zoom/2)+(random(1)-0.5)*100*${speed}`)}:y=${esc(`ih/2-(ih/zoom/2)+(random(1)-0.5)*100*${speed}`)}${base}`;
             break;
        case 'mov-jitter-x':
        case 'jitter':
             effect = `zoompan=z=1.05:x=${esc(`iw/2-(iw/zoom/2)+(random(1)-0.5)*30*${speed}`)}:y=ih/2-(ih/zoom/2)${base}`;
             break;
        case 'mov-rgb-shift-move':
             effect = `zoompan=z=1.1:x=${esc(`iw/2-(iw/zoom/2)+(random(1)-0.5)*20*${speed}`)}:y=ih/2-(ih/zoom/2)${base},colorchannelmixer=rr=1:gg=0:bb=0:rb=0:br=0:bg=0`;
             break;

        // === 5. ELASTIC & FUN ===
        case 'mov-rubber-band':
        case 'mov-squash-stretch':
             effect = `zoompan=z=${esc(`1.0+0.1*${speed}*abs(sin(on*0.3*${speed}))`)}:${center}${base}`;
             break;
        case 'mov-jelly-wobble':
             effect = `zoompan=z=${esc(`1.05+0.05*${speed}*sin(on*0.5*${speed})`)}:x=${esc(`iw/2-(iw/zoom/2)+5*${speed}*sin(on*0.8*${speed})`)}:y=${esc(`ih/2-(ih/zoom/2)+5*${speed}*cos(on*0.7*${speed})`)}${base}`;
             break;
        case 'mov-pop-up':
        case 'pop-in':
            effect = `zoompan=z=${esc(`if(lte(on,15/${speed}),min(on*${speed}/15,1.0),1.0)`)}:${center}${base}`;
            break;
        case 'mov-bounce-drop':
             effect = `zoompan=z=${esc(`if(lt(on,20/${speed}),1.0+0.2*${speed}*abs(cos(on*0.3*${speed})),1.0)`)}:${center}${base}`;
             break;

        // === 6. HANDHELD (Câmera na mão) ===
        case 'handheld-1':
        case 'handheld':
             effect = `zoompan=z=1.15:x=${esc(`(iw-iw/zoom)/2 + (sin(on/40)*6)`)}:y=${esc(`(ih-ih/zoom)/2 + (cos(on/55)*4)`)}:d=${FRAMES_BUFFER}:s=${W}x${H}`;
             break;
        case 'handheld-2':
             effect = `zoompan=z=1.1:x=${esc(`iw/2-(iw/zoom/2)+sin(on*0.1*${speed})*10`)}:y=${esc(`ih/2-(ih/zoom/2)+cos(on*0.15*${speed})*10`)}${base}`;
             break;
        case 'earthquake':
             effect = `zoompan=z=1.1:x=${esc(`iw/2-(iw/zoom/2)+(random(1)-0.5)*40*${speed}`)}:y=${esc(`ih/2-(ih/zoom/2)+(random(1)-0.5)*40*${speed}`)}${base}`;
             break;

        // === 7. ENTRADAS ===
        case 'slide-in-left': 
            effect = `zoompan=z=1.0:x=${esc(`if(lte(on,30/${speed}),(iw/2-(iw/zoom/2)) - (iw)*(1-on*${speed}/30), iw/2-(iw/zoom/2))`)}:y=ih/2-(ih/zoom/2)${base}`;
            break;
        case 'slide-in-right':
            effect = `zoompan=z=1.0:x=${esc(`if(lte(on,30/${speed}),(iw/2-(iw/zoom/2)) + (iw)*(1-on*${speed}/30), iw/2-(iw/zoom/2))`)}:y=ih/2-(ih/zoom/2)${base}`;
            break;
        
        case 'static':
        default:
            return `${preProcess},fps=30,format=yuv420p`;
    }

    // Se é vídeo e não imagem, normalmente não aplicamos zoompan agressivo, 
    // mas se o efeito foi definido, aplicamos.
    return `${preProcess},${effect},${postProcess}`;
}
