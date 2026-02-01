
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const fps = 30; 
    const totalFrames = Math.ceil(d * fps);
    
    // ==========================================================================================
    // SEGURANÇA MÁXIMA: Pre-scale
    // Redimensiona a imagem para 4x o tamanho antes de aplicar o zoom.
    // Isso evita pixelização e garante buffer para o movimento.
    // ==========================================================================================
    const pre = `scale=${targetW*4}:${targetH*4}:force_original_aspect_ratio=increase,crop=${targetW*4}:${targetH*4},setsar=1`;
    
    // Configurações do Zoompan
    // d=... define a duração. Multiplicamos por 2 para evitar que o vídeo acabe antes do tempo.
    // s=... define a resolução de saída.
    const zdur = `:d=${totalFrames*2}:s=${targetW}x${targetH}:fps=${fps}`;
    
    // Normalização do tempo (0.0 a 1.0)
    // on: Output Frame Number
    const p = `(on/${totalFrames})`; 

    const moves = {
        // --- 1. ESTÁTICO & SUAVE (Safe) ---
        'static': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'kenburns': `zoompan=z='min(1.2, 1.0+0.0005*on)':x='(iw/2-(iw/zoom/2))':y='(ih/2-(ih/zoom/2))'${zdur}`,
        'mov-3d-float': `zoompan=z='1.2+0.05*sin(on/60)':x='iw/2-(iw/zoom/2)+20*sin(on/50)':y='ih/2-(ih/zoom/2)+20*cos(on/60)'${zdur}`,
        
        'mov-tilt-up-slow': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/8 * ${p})'${zdur}`,
        'mov-tilt-down-slow': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/8 * ${p})'${zdur}`,

        // --- 2. ZOOM DINÂMICO (Clamped & Safe) ---
        'zoom-in': `zoompan=z='min(2.5, 1.0+(1.5*${p}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'zoom-out': `zoompan=z='max(1.0, 2.5-(1.5*${p}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        
        'mov-zoom-crash-in': `zoompan=z='min(4, 1.0+0.15*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-crash-out': `zoompan=z='max(1, 4-0.15*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-dolly-vertigo': `zoompan=z='1.0+(0.8*${p})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        
        // --- 3. PANORÂMICAS "EMPURRAR" (CRASH PROOF) ---
        // Zoom base 2.0 para garantir margem
        'mov-pan-slow-l': `zoompan=z=2.0:x='(iw/2-(iw/zoom/2)) + (iw/6 * ${p})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-r': `zoompan=z=2.0:x='(iw/2-(iw/zoom/2)) - (iw/6 * ${p})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-u': `zoompan=z=2.0:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/6 * ${p})'${zdur}`,
        'mov-pan-slow-d': `zoompan=z=2.0:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/6 * ${p})'${zdur}`,

        'mov-pan-fast-l': `zoompan=z=2.0:x='(iw/2-(iw/zoom/2)) + (iw/5 * ${p})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-fast-r': `zoompan=z=2.0:x='(iw/2-(iw/zoom/2)) - (iw/5 * ${p})':y='ih/2-(ih/zoom/2)'${zdur}`,

        // --- 4. BLUR & FOCO (REAL GAUSSIAN BLUR) ---
        // Usamos 'gblur' com sigma animado. 
        // max(0, ...) protege contra valores negativos que causam crash.
        // Sigma 30 cria um desfoque forte e visível.
        
        // Blur In: Sigma 30 -> 0 (Desfocado -> Focado)
        'mov-blur-in': `zoompan=z='1.0+0.1*${p}'${zdur},gblur=sigma='max(0, 30-30*${p})':steps=1`, 
        
        // Blur Out: Sigma 0 -> 30 (Focado -> Desfocado)
        'mov-blur-out': `zoompan=z='1.1-0.1*${p}'${zdur},gblur=sigma='max(0, 30*${p})':steps=1`,
        
        // Pulse: 0 -> 15 -> 0
        'mov-blur-pulse': `zoompan=z='1.05+0.05*sin(on/10)'${zdur},gblur=sigma='max(0, 15*sin(on/15))':steps=1`,
        
        // Tilt Shift: Blur estático nas bordas via vignette + boxblur leve
        'mov-tilt-shift': `zoompan=z=1.1${zdur},boxblur=2:1,vignette=a=PI/5`,

        // --- 5. EFEITOS ESPECIAIS ---
        'handheld-1': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)+15*sin(on/10)':y='ih/2-(ih/zoom/2)+15*cos(on/12)'${zdur}`,
        'earthquake': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)+40*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+40*(random(1)-0.5)'${zdur}`,
        
        'mov-rgb-shift-move': `zoompan=z=1.1${zdur},rgbashift=rh=10:bv=10`,
        'mov-glitch-snap': `zoompan=z='if(mod(on,30)<3, 1.3, 1.0)'${zdur},noise=alls=10:allf=t`
    };

    const selectedFilter = moves[moveId] || moves['kenburns'];
    
    // Pós-processamento para garantir formato final
    const post = `scale=${targetW}:${targetH}:flags=lanczos,setsar=1,fps=${fps},format=yuv420p`;
    
    return `${pre},${selectedFilter},${post}`;
}
