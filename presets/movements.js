
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const fps = 30; 
    const totalFrames = Math.ceil(d * fps);
    
    // ==========================================================================================
    // PRE-SCALE & PADDING: Evita bordas pretas durante o movimento
    // ==========================================================================================
    const pre = `scale=${targetW*4}:${targetH*4}:force_original_aspect_ratio=increase,crop=${targetW*4}:${targetH*4},setsar=1`;
    
    // Zoompan Base Config
    // d=... frames totais (2x duração para segurança)
    const zdur = `:d=${totalFrames*2}:s=${targetW}x${targetH}:fps=${fps}`;
    
    // Variável 'on' (Output Number) é exclusiva do zoompan.
    // Variável 't' (Time) é usada nos filtros seguintes (boxblur).
    
    // Normalização para o zoompan (0 a 1 durante o clipe)
    const p_zoom = `(on/${totalFrames})`; 

    const moves = {
        // --- 1. ESTÁTICO & SUAVE ---
        'static': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'kenburns': `zoompan=z='min(1.2, 1.0+0.0005*on)':x='(iw/2-(iw/zoom/2))':y='(ih/2-(ih/zoom/2))'${zdur}`,
        'mov-3d-float': `zoompan=z='1.2+0.05*sin(on/60)':x='iw/2-(iw/zoom/2)+20*sin(on/50)':y='ih/2-(ih/zoom/2)+20*cos(on/60)'${zdur}`,
        
        'mov-tilt-up-slow': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/8 * ${p_zoom})'${zdur}`,
        'mov-tilt-down-slow': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/8 * ${p_zoom})'${zdur}`,

        // --- 2. ZOOM DINÂMICO ---
        'zoom-in': `zoompan=z='min(2.5, 1.0+(1.5*${p_zoom}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'zoom-out': `zoompan=z='max(1.0, 2.5-(1.5*${p_zoom}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-crash-in': `zoompan=z='min(4, 1.0+0.15*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-dolly-vertigo': `zoompan=z='1.0+(0.8*${p_zoom})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        
        // --- 3. PANORÂMICAS (ZOOM 2.0 SAFE) ---
        'mov-pan-slow-l': `zoompan=z=2.0:x='(iw/2-(iw/zoom/2)) + (iw/6 * ${p_zoom})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-r': `zoompan=z=2.0:x='(iw/2-(iw/zoom/2)) - (iw/6 * ${p_zoom})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-u': `zoompan=z=2.0:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/6 * ${p_zoom})'${zdur}`,
        'mov-pan-slow-d': `zoompan=z=2.0:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/6 * ${p_zoom})'${zdur}`,

        // --- 4. BLUR & FOCO (BOXBLUR TIME-BASED) ---
        // Usamos 't' (tempo em segundos). O 'boxblur' aceita expressões em 'lr' (luma radius).
        // if(lt(t,1.5)...) garante que o blur só acontece nos primeiros 1.5s.
        
        // Blur In: Começa em 40, vai a 0 em 1.5s
        'mov-blur-in': `zoompan=z='1.0+0.05*on'${zdur},boxblur=lr='if(lt(t,1.5), 40*(1-t/1.5), 0)':lp=2`,
        
        // Blur Out: Começa em 0, vai a 40 nos últimos 1.5s (d = duração total)
        'mov-blur-out': `zoompan=z='1.0+0.05*on'${zdur},boxblur=lr='if(gt(t,${d-1.5}), 40*((t-(${d-1.5}))/1.5), 0)':lp=2`,
        
        // Pulse: Oscilação suave
        'mov-blur-pulse': `zoompan=z='1.05+0.05*sin(on/10)'${zdur},boxblur=lr='10+10*sin(t*3)':lp=2`,
        
        // Tilt Shift: Blur estático leve
        'mov-tilt-shift': `zoompan=z=1.1${zdur},boxblur=lr=2:lp=1,vignette=a=PI/5`,

        // --- 5. EFEITOS ESPECIAIS ---
        'handheld-1': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)+15*sin(on/10)':y='ih/2-(ih/zoom/2)+15*cos(on/12)'${zdur}`,
        'earthquake': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)+40*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+40*(random(1)-0.5)'${zdur}`,
        'mov-rgb-shift-move': `zoompan=z=1.1${zdur},rgbashift=rh=10:bv=10`,
        'mov-glitch-snap': `zoompan=z='if(mod(on,30)<3, 1.3, 1.0)'${zdur},noise=alls=10:allf=t`
    };

    const selectedFilter = moves[moveId] || moves['kenburns'];
    const post = `scale=${targetW}:${targetH}:flags=lanczos,setsar=1,fps=${fps},format=yuv420p`;
    
    return `${pre},${selectedFilter},${post}`;
}
