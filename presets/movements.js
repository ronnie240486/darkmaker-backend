
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    // Garantir que duration seja número e tenha fallback
    const d = parseFloat(durationSec) > 0 ? parseFloat(durationSec) : 5;
    const fps = 30; 
    const totalFrames = Math.ceil(d * fps);
    
    // ==========================================================================================
    // PRE-SCALE 2x: Otimizado para performance e qualidade
    // Force even dimensions for libx264 compatibility: trunc(w/2)*2
    // ==========================================================================================
    const pre = `scale=trunc(${targetW*2}/2)*2:trunc(${targetH*2}/2)*2:force_original_aspect_ratio=increase,crop=trunc(${targetW*2}/2)*2:trunc(${targetH*2}/2)*2,setsar=1`;
    
    // Zoompan Base Config
    const zdur = `:d=${totalFrames*2}:s=${targetW}x${targetH}:fps=${fps}`;
    const p_zoom = `(on/${totalFrames})`; 

    // --- FILTROS DE BLUR AUXILIARES (CORRIGIDOS) ---
    
    // Blur In: Começa muito desfocado (40px) e foca rápido (até 30% do tempo)
    // Depois fica nítido.
    const blurIn = `,boxblur=40:2:enable='lt(t,${d*0.15})',boxblur=10:1:enable='between(t,${d*0.15},${d*0.3})'`;
    
    // Blur Out: Começa nítido.
    // 50% do tempo: Começa um blur leve (5px).
    // 75% do tempo: Blur pesado (30px).
    // Isso garante que "fique o mesmo" apenas na primeira metade, depois muda drasticamente.
    const blurOut = `,boxblur=5:1:enable='between(t,${d*0.5},${d*0.8})',boxblur=40:3:enable='gte(t,${d*0.8})'`;
    
    const pulseBlur = `,boxblur=15:1:enable='between(mod(t,2),0,0.5)'`; // Pulso a cada 2s

    const moves = {
        // --- 1. ESTÁTICO & SUAVE ---
        'static': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'kenburns': `zoompan=z='min(1.2, 1.0+0.001*on)':x='(iw/2-(iw/zoom/2))':y='(ih/2-(ih/zoom/2))'${zdur}`,
        
        // Flutuar (Float) - VERSÃO ULTRA (High Intensity):
        'mov-3d-float': `zoompan=z='1.5+0.05*sin(on/80)':x='iw/2-(iw/zoom/2)+150*sin(on/70)':y='ih/2-(ih/zoom/2)+80*cos(on/90)'${zdur}`,
        
        'mov-tilt-up-slow': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/10 * ${p_zoom})'${zdur}`,
        'mov-tilt-down-slow': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/10 * ${p_zoom})'${zdur}`,

        // --- 2. ZOOM DINÂMICO ---
        'zoom-in': `zoompan=z='min(1.5, 1.0+(0.5*${p_zoom}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'zoom-out': `zoompan=z='max(1.0, 1.5-(0.5*${p_zoom}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-crash-in': `zoompan=z='min(3, 1.0+0.1*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-dolly-vertigo': `zoompan=z='1.0+(0.4*${p_zoom})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        
        // --- 3. PANORÂMICAS (SIMPLES) ---
        'mov-pan-slow-l': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) + (iw/8 * ${p_zoom})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-r': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) - (iw/8 * ${p_zoom})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-u': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/8 * ${p_zoom})'${zdur}`,
        'mov-pan-slow-d': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/8 * ${p_zoom})'${zdur}`,

        // --- 3.1 PANORÂMICAS (DIAGONAIS) ---
        'mov-pan-diag-tl': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) - (iw/8 * ${p_zoom})':y='(ih/2-(ih/zoom/2)) - (ih/8 * ${p_zoom})'${zdur}`,
        'mov-pan-diag-tr': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) + (iw/8 * ${p_zoom})':y='(ih/2-(ih/zoom/2)) - (ih/8 * ${p_zoom})'${zdur}`,
        'mov-pan-diag-bl': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) - (iw/8 * ${p_zoom})':y='(ih/2-(ih/zoom/2)) + (ih/8 * ${p_zoom})'${zdur}`,
        'mov-pan-diag-br': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) + (iw/8 * ${p_zoom})':y='(ih/2-(ih/zoom/2)) + (ih/8 * ${p_zoom})'${zdur}`,

        // --- 4. BLUR & FOCO ---
      
        // Focar (Blur In): Começa desfocado (20) e termina focado (0) gradualmente
        'mov-blur-in': `boxblur=luma_radius='20*(1-${t})':luma_power=1,${zp}:z=1${center}`,
        
        // Desfocar (Blur Out): Começa focado (0) e termina desfocado (20) gradualmente
        'mov-blur-out': `boxblur=luma_radius='20*${t}':luma_power=1,${zp}:z=1${center}`,
        
        'mov-blur-pulse': `boxblur=luma_radius='10*abs(sin(on/10))',zoompan=z=1${zdur}`,
        
        // Tilt Shift: Bordas superiores e inferiores desfocam gradualmente
        'mov-tilt-shift': `boxblur=luma_radius='10*${t}':luma_power=2:enable='if(between(y,0,h*0.3)+between(y,h*0.7,h),1,0)',eq=saturation=1.3:contrast=1.1,${zp}:z=1.1${center}`


        // --- 5. EFEITOS ESPECIAIS & MOVIMENTO REALISTA ---
        'handheld-1': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+8*sin(on/15)':y='ih/2-(ih/zoom/2)+8*cos(on/18)'${zdur}`,
        'handheld-2': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+15*sin(on/12)':y='ih/2-(ih/zoom/2)+12*cos(on/15)'${zdur}`,
        'earthquake': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+20*sin(on*50)':y='ih/2-(ih/zoom/2)+20*cos(on*43)'${zdur}`,
        'mov-jitter-x': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+15*sin(on*20)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-walk': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+5*sin(on/30)':y='ih/2-(ih/zoom/2)+10*abs(sin(on/15))'${zdur}`,
        'mov-run': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+10*sin(on/15)':y='ih/2-(ih/zoom/2)+20*abs(sin(on/8))'${zdur}`,
        
        // --- 6. GLITCH & CAOS ---
        'mov-rgb-shift-move': `zoompan=z='1.1+0.05*sin(on/15)'${zdur},hue=h='20*sin(10*t)'`,
        'mov-glitch-snap': `zoompan=z='if(gt(sin(on/5),0.9), 1.4, 1.05)'${zdur},noise=alls=20:allf=t`,
        'mov-glitch-skid': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+30*sin(on*20)':y='ih/2-(ih/zoom/2)'${zdur},boxblur=4:1`,
        'mov-shake-violent': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)+60*sin(on*10)':y='ih/2-(ih/zoom/2)+60*cos(on*12)'${zdur},boxblur=10:1`,
        'mov-vibrate': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)+10*sin(on*50)'${zdur},boxblur=2:1`,

        // --- 7. ELÁSTICO & DIVERTIDO ---
        'mov-zoom-wobble': `zoompan=z='1.25+0.02*sin(on/30)':x='iw/2-(iw/zoom/2)+40*sin(on/20)':y='ih/2-(ih/zoom/2)+30*cos(on/25)'${zdur}`,
        'mov-jelly-wobble': `zoompan=z='1.2+0.03*sin(on/15)':x='iw/2-(iw/zoom/2)+30*sin(on/10)':y='ih/2-(ih/zoom/2)+30*cos(on/12)'${zdur},boxblur=2:1`,
        'mov-rubber-band': `zoompan=z='1.0+0.3*abs(sin(on/15))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pop-up': `zoompan=z='min(1.2, 1.0+(on/10)*0.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-bounce-drop': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2) - 150*cos(on/5)/(1+on*0.1)'${zdur}`
    };

    const selectedFilter = moves[moveId] || moves['kenburns'];
    // Force even output dimensions
    const post = `scale=trunc(${targetW}/2)*2:trunc(${targetH}/2)*2:flags=lanczos,setsar=1,fps=${fps},format=yuv420p`;
    
    return `${pre},${selectedFilter},${post}`;
}
