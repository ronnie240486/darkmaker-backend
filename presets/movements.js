
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const fps = 30; 
    const totalFrames = Math.ceil(d * fps);
    
    // ==========================================================================================
    // OTIMIZAÇÃO: Scale 2x (antes era 4x)
    // Reduz carga de memória evitando falha de pipe em ambientes com RAM limitada.
    // 2x (2560x1440 para 720p) ainda oferece qualidade suficiente para zoom digital.
    // ==========================================================================================
    const pre = `scale=${targetW*2}:${targetH*2}:force_original_aspect_ratio=increase,crop=${targetW*2}:${targetH*2},setsar=1`;
    
    // Zoompan Base Config
    // d=... frames totais (2x duração para segurança do buffer)
    const zdur = `:d=${totalFrames*2}:s=${targetW}x${targetH}:fps=${fps}`;
    
    // Normalização (0 a 1) para zoompan
    const p_zoom = `(on/${totalFrames})`; 

    // --- STEP BLUR TECHNIQUE ---
    // Em vez de expressões dinâmicas (que quebram em alguns FFmpegs), usamos estágios.
    // Isso é 100% compatível e evita o erro "Invalid argument".
    const blurIn = `,boxblur=20:1:enable='lt(t,0.3)',boxblur=10:1:enable='between(t,0.3,0.6)',boxblur=4:1:enable='between(t,0.6,0.9)'`;
    const blurOut = `,boxblur=4:1:enable='between(t,${d-0.9},${d-0.6})',boxblur=10:1:enable='between(t,${d-0.6},${d-0.3})',boxblur=20:1:enable='gt(t,${d-0.3})'`;
    const pulseBlur = `,boxblur=10:1:enable='between(mod(t,2),0,0.2)'`; // Pulsa a cada 2s

    const moves = {
        // --- 1. ESTÁTICO & SUAVE ---
        'static': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'kenburns': `zoompan=z='min(1.2, 1.0+0.0005*on)':x='(iw/2-(iw/zoom/2))':y='(ih/2-(ih/zoom/2))'${zdur}`,
        'mov-3d-float': `zoompan=z='1.1+0.05*sin(on/60)':x='iw/2-(iw/zoom/2)+10*sin(on/50)':y='ih/2-(ih/zoom/2)+10*cos(on/60)'${zdur}`,
        
        'mov-tilt-up-slow': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/8 * ${p_zoom})'${zdur}`,
        'mov-tilt-down-slow': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/8 * ${p_zoom})'${zdur}`,

        // --- 2. ZOOM DINÂMICO ---
        'zoom-in': `zoompan=z='min(2.5, 1.0+(1.5*${p_zoom}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'zoom-out': `zoompan=z='max(1.0, 2.5-(1.5*${p_zoom}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-crash-in': `zoompan=z='min(4, 1.0+0.15*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-dolly-vertigo': `zoompan=z='1.0+(0.8*${p_zoom})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        
        // --- 3. PANORÂMICAS (SAFE) ---
        'mov-pan-slow-l': `zoompan=z=2.0:x='(iw/2-(iw/zoom/2)) + (iw/6 * ${p_zoom})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-r': `zoompan=z=2.0:x='(iw/2-(iw/zoom/2)) - (iw/6 * ${p_zoom})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-u': `zoompan=z=2.0:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/6 * ${p_zoom})'${zdur}`,
        'mov-pan-slow-d': `zoompan=z=2.0:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/6 * ${p_zoom})'${zdur}`,

        // --- 4. BLUR & FOCO (CORRIGIDO - NO CRASH) ---
        // Usamos zoompan padrão + o efeito de blur em etapas definido acima
        'mov-blur-in': `zoompan=z='1.0+0.05*on'${zdur}${blurIn}`,
        'mov-blur-out': `zoompan=z='1.0+0.05*on'${zdur}${blurOut}`,
        'mov-blur-pulse': `zoompan=z='1.05+0.05*sin(on/10)'${zdur}${pulseBlur}`,
        
        // Tilt Shift: Blur estático nas bordas (Vignette + Blur leve constante)
        'mov-tilt-shift': `zoompan=z=1.1${zdur},boxblur=2:1,vignette=a=PI/5`,

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
