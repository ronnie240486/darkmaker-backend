
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const fps = 24; 
    const totalFrames = Math.ceil(d * fps);
    
    // Resize chain to ensure input fits and result is standard
    const pre = `scale=${targetW*2}:${targetH*2}:force_original_aspect_ratio=increase,crop=${targetW*2}:${targetH*2},setsar=1`;
    const post = `scale=${targetW}:${targetH}:flags=lanczos,fps=${fps},format=yuv420p`;
    
    // Zoompan duration settings
    // Added padding to prevent early stream termination
    const zdur = `:d=${totalFrames + 48}:s=${targetW}x${targetH}`;
    
    // Time variables
    // tz: Time normalized (0 to 1) for ZOOMPAN.
    const tz = `(on/${totalFrames})`; 
    
    // tg: Time normalized (0 to 1) for GENERIC filters.
    // Using 'n' ensures integer stability.
    const tg = `(n/${totalFrames})`;

    const moves = {
        // --- ESTÁTICO & SUAVE ---
        'static': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'kenburns': `zoompan=z='1.0+(0.3*${tz})':x='(iw/2-(iw/zoom/2))*(1-0.2*${tz})':y='(ih/2-(ih/zoom/2))*(1-0.2*${tz})'${zdur}`,
        'mov-3d-float': `zoompan=z='1.1+0.05*sin(on/24)':x='iw/2-(iw/zoom/2)+10*sin(on/40)':y='ih/2-(ih/zoom/2)+10*sin(on/50)'${zdur}`,
        'mov-tilt-up-slow': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))+(ih/4*${tz})'${zdur}`,
        'mov-tilt-down-slow': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))-(ih/4*${tz})'${zdur}`,

        // --- ZOOM DINÂMICO ---
        'zoom-in': `zoompan=z='min(1.5, 1.0+(0.5*${tz}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'zoom-out': `zoompan=z='max(1.0, 1.5-(0.5*${tz}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-crash-in': `zoompan=z='min(4, 1.0+3*${tz}*${tz}*${tz})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-crash-out': `zoompan=z='max(1, 4-3*${tz})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-bounce-in': `zoompan=z='if(lt(${tz},0.8), 1.0+0.5*${tz}, 1.5-0.1*sin((${tz}-0.8)*20))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-pulse-slow': `zoompan=z='1.1+0.1*sin(on/24)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-dolly-vertigo': `zoompan=z='1.0+(1.0*${tz})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-twist-in': `zoompan=z='1.0+(0.5*${tz})'${zdur},rotate=angle='(PI/12)*${tg}':fillcolor=black:ow=${targetW}:oh=${targetH}`,
        'mov-zoom-wobble': `zoompan=z='1.1':x='iw/2-(iw/zoom/2)+20*sin(on/10)':y='ih/2-(ih/zoom/2)+20*cos(on/10)'${zdur}`,
        'mov-scale-pulse': `zoompan=z='1.0+0.2*sin(on/10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,

        // --- BLUR (SAFE MODE) ---
        // Uses strict clamping to avoid expression errors
        'mov-blur-in': `zoompan=z=1${zdur},boxblur=lr='min(40, 40*(1-min(1,${tg})))':lp=2`,
        'mov-blur-out': `zoompan=z=1${zdur},boxblur=lr='min(40, 40*${tg})':lp=2`,
        'mov-blur-pulse': `zoompan=z=1${zdur},boxblur=lr='min(20, 10*abs(sin(${tg}*PI*2)))':lp=1`,
        'mov-tilt-shift': `zoompan=z='1.0+(0.1*${tz})'${zdur},boxblur=lr=2:lp=1,vignette=a=PI/5`,

        // --- PANORÂMICAS (SAFE MARGINS) ---
        // Increased base zoom to 1.5 to prevent "Push" movements from hitting image edges
        'mov-pan-slow-l': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2))*(1+0.5*${tz})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-r': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2))*(1-0.5*${tz})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-u': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))*(1+0.5*${tz})'${zdur}`,
        'mov-pan-slow-d': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))*(1-0.5*${tz})'${zdur}`,
        
        'mov-pan-fast-l': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2))*(1+0.8*${tz})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-fast-r': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2))*(1-0.8*${tz})':y='ih/2-(ih/zoom/2)'${zdur}`,
        
        'mov-pan-diag-tl': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2))*(1+0.4*${tz})':y='(ih/2-(ih/zoom/2))*(1+0.4*${tz})'${zdur}`,
        'mov-pan-diag-br': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2))*(1-0.4*${tz})':y='(ih/2-(ih/zoom/2))*(1-0.4*${tz})'${zdur}`,

        // --- EFEITOS ESPECIAIS ---
        'mov-3d-spin-axis': `zoompan=z=1.2${zdur},rotate=angle='2*PI*${tg}':fillcolor=black:ow=${targetW}:oh=${targetH}`,
        'mov-3d-flip-x': `zoompan=z=1${zdur}`, 
        'mov-3d-flip-y': `zoompan=z=1${zdur}`,
        'mov-3d-swing-l': `zoompan=z=1.2${zdur},rotate=angle='(PI/8)*sin(2*PI*${tg})':fillcolor=black:ow=${targetW}:oh=${targetH}`,
        'mov-3d-roll': `zoompan=z=1.5${zdur},rotate=angle='2*PI*${tg}':fillcolor=black:ow=${targetW}:oh=${targetH}`,

        'mov-glitch-snap': `zoompan=z='if(mod(on,20)<2, 1.3, 1.0)':x='iw/2-(iw/zoom/2)+if(mod(on,20)<2, 50, 0)':y='ih/2-(ih/zoom/2)'${zdur},noise=alls=20:allf=t`,
        'mov-rgb-shift-move': `zoompan=z=1.05${zdur},rgbashift=rh=20:bv=20`,

        'handheld-1': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+10*sin(on/10)':y='ih/2-(ih/zoom/2)+10*cos(on/15)'${zdur}`,
        'handheld-2': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+20*sin(on/6)':y='ih/2-(ih/zoom/2)+20*cos(on/9)'${zdur}`,
        'earthquake': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+40*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+40*(random(1)-0.5)'${zdur}`,
        'mov-jitter-x': `zoompan=z=1.05:x='iw/2-(iw/zoom/2)+10*sin(on*10)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-walk': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+15*sin(on/15)':y='ih/2-(ih/zoom/2)+10*abs(sin(on/7))'${zdur}`,
        
        'mov-glitch-skid': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)+if(mod(on,10)<2, 100, 0)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-shake-violent': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+60*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+60*(random(1)-0.5)'${zdur}`,
        'mov-vibrate': `zoompan=z=1.02:x='iw/2-(iw/zoom/2)+5*sin(on*50)':y='ih/2-(ih/zoom/2)+5*cos(on*50)'${zdur}`,
        'mov-rubber-band': `zoompan=z='1.0+0.3*abs(sin(on/10))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-jelly-wobble': `zoompan=z='1.0+0.1*sin(on/5)':x='iw/2-(iw/zoom/2)+10*sin(on/4)':y='ih/2-(ih/zoom/2)+10*cos(on/4)'${zdur}`,
        'mov-pop-up': `zoompan=z='min(1.0 + ${tz}*5, 1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-bounce-drop': `zoompan=z='1.0':y='(ih/2-(ih/zoom/2)) + (ih/2 * abs(cos(${tz}*5*PI)) * (1-${tz}))'${zdur}`
    };

    const selectedFilter = moves[moveId] || moves['kenburns'];
    return `${pre},${selectedFilter},${post}`;
}
