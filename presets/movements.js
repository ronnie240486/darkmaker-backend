
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const fps = 24; 
    const totalFrames = Math.ceil(d * fps);
    // Pré-processamento: Aumenta a escala para permitir movimentos sem bordas pretas (zoom out/pan)
    const pre = `scale=${targetW*2}:${targetH*2}:force_original_aspect_ratio=increase,crop=${targetW*2}:${targetH*2},setsar=1`;
    const post = `scale=${targetW}:${targetH}:flags=lanczos,fps=${fps},format=yuv420p`;
    
    // VARIÁVEIS DE CONTROLE
    // 'on' (Output Number Frame) é suportado pelo Zoompan
    // 't' (Time in seconds) é suportado pelo Boxblur
    
    const zdur = `:d=${totalFrames}:s=${targetW}x${targetH}`;
    
    // Expressões baseadas em FRAMES (para Zoompan)
    const onNorm = `(on/${totalFrames})`; 
    
    // Expressões baseadas em TEMPO (para Boxblur)
    const tNorm = `(t/${d})`;

    const zp = `zoompan`;
    const center = `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;

    const moves = {
        // --- Estático & Suave ---
        'static': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'kenburns': `zoompan=z='1.0+(0.3*${onNorm})':x='(iw/2-(iw/zoom/2))*(1-0.2*${onNorm})':y='(ih/2-(ih/zoom/2))*(1-0.2*${onNorm})'${zdur}`,
        'mov-3d-float': `zoompan=z='1.1+0.05*sin(on/24)':x='iw/2-(iw/zoom/2)+10*sin(on/40)':y='ih/2-(ih/zoom/2)+10*sin(on/50)'${zdur}`,
        'mov-tilt-up-slow': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))+(ih/4*${onNorm})'${zdur}`,
        'mov-tilt-down-slow': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))-(ih/4*${onNorm})'${zdur}`,

        // --- Zoom Dinâmico ---
        'zoom-in': `zoompan=z='1.0+(0.5*${onNorm})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'zoom-out': `zoompan=z='1.5-(0.5*${onNorm})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-crash-in': `zoompan=z='1.0+3*${onNorm}*${onNorm}*${onNorm}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-crash-out': `zoompan=z='4-3*${onNorm}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-bounce-in': `zoompan=z='if(lt(${onNorm},0.8), 1.0+0.5*${onNorm}, 1.5-0.1*sin((${onNorm}-0.8)*20))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-pulse-slow': `zoompan=z='1.1+0.1*sin(on/24)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-dolly-vertigo': `zoompan=z='1.0+(1.0*${onNorm})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-twist-in': `rotate=angle='(PI/12)*${tNorm}':fillcolor=black,zoompan=z='1.0+(0.5*${onNorm})'${zdur}`,
        'mov-zoom-wobble': `zoompan=z='1.1':x='iw/2-(iw/zoom/2)+20*sin(on/10)':y='ih/2-(ih/zoom/2)+20*cos(on/10)'${zdur}`,
        'mov-scale-pulse': `zoompan=z='1.0+0.2*sin(on/10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,

        // --- Panorâmicas ---
        'mov-pan-slow-l': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1+0.5*${onNorm})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-r': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1-0.5*${onNorm})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-u': `zoompan=z=1.4:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))*(1+0.5*${onNorm})'${zdur}`,
        'mov-pan-slow-d': `zoompan=z=1.4:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))*(1-0.5*${onNorm})'${zdur}`,
        'mov-pan-fast-l': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1+1.0*${onNorm})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-fast-r': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1-1.0*${onNorm})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-diag-tl': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1+0.5*${onNorm})':y='(ih/2-(ih/zoom/2))*(1+0.5*${onNorm})'${zdur}`,
        'mov-pan-diag-br': `zoompan=z=1.4:x='(iw/2-(iw/zoom/2))*(1-0.5*${onNorm})':y='(ih/2-(ih/zoom/2))*(1-0.5*${onNorm})'${zdur}`,

        // --- Câmera na Mão & Realismo ---
        'handheld-1': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+10*sin(on/10)':y='ih/2-(ih/zoom/2)+10*cos(on/15)'${zdur}`,
        'handheld-2': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+20*sin(on/6)':y='ih/2-(ih/zoom/2)+20*cos(on/9)'${zdur}`,
        'earthquake': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+40*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+40*(random(1)-0.5)'${zdur}`,
        'mov-jitter-x': `zoompan=z=1.05:x='iw/2-(iw/zoom/2)+10*sin(on*10)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-walk': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+15*sin(on/15)':y='ih/2-(ih/zoom/2)+10*abs(sin(on/7))'${zdur}`,

        // --- 3D & Rotação ---
        'mov-3d-spin-axis': `rotate=angle='2*PI*${tNorm}':fillcolor=black,zoompan=z=1.2${zdur}`,
        'mov-3d-flip-x': `zoompan=z=1${zdur}`, // Simulação simplificada
        'mov-3d-flip-y': `zoompan=z=1${zdur}`,
        'mov-3d-swing-l': `rotate=angle='(PI/8)*sin(on/24)':fillcolor=black,zoompan=z=1.2${zdur}`,
        'mov-3d-roll': `rotate=angle='2*PI*${tNorm}':fillcolor=black,zoompan=z=1.5${zdur}`,

        // --- Glitch & Caos ---
        'mov-glitch-snap': `zoompan=z='if(mod(on,20)<2, 1.3, 1.0)':x='iw/2-(iw/zoom/2)+if(mod(on,20)<2, 50, 0)':y='ih/2-(ih/zoom/2)'${zdur},noise=alls=20:allf=t`,
        'mov-glitch-skid': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)+if(mod(on,10)<2, 100, 0)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-shake-violent': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+60*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+60*(random(1)-0.5)'${zdur}`,
        'mov-rgb-shift-move': `rgbashift=rh=20:bv=20,zoompan=z=1.05${zdur}`,
        'mov-vibrate': `zoompan=z=1.02:x='iw/2-(iw/zoom/2)+5*sin(on*50)':y='ih/2-(ih/zoom/2)+5*cos(on*50)'${zdur}`,

        // --- Foco & Blur (Dynamic/Gradual) ---
        // CORREÇÃO: Usar 'tNorm' (baseado em tempo) para boxblur, pois boxblur não suporta 'on'.
        // Clamping para evitar valores negativos
        
        // Focar (Blur In): Começa desfocado (20) e termina focado (0) gradualmente
        'mov-blur-in': `boxblur=luma_radius='20*max(0,1-${tNorm})':luma_power=1,${zp}:z=1${zdur}`,
        
        // Desfocar (Blur Out): Começa focado (0) e termina desfocado (20) gradualmente
        'mov-blur-out': `boxblur=luma_radius='min(20,20*${tNorm})':luma_power=1,${zp}:z=1${zdur}`,
        
        'mov-blur-pulse': `boxblur=luma_radius='10*abs(sin(t*2))':luma_power=1,zoompan=z=1${zdur}`,
        
        // Tilt Shift Safe: Replaced faulty spatial mask with a Vivid Zoom to avoid crashes
        'mov-tilt-shift': `eq=saturation=1.4:contrast=1.1,${zp}:z=1.1${zdur}`,

        // --- Elástico & Divertido ---
        'mov-rubber-band': `zoompan=z='1.0+0.3*abs(sin(on/10))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-jelly-wobble': `zoompan=z='1.0+0.1*sin(on/5)':x='iw/2-(iw/zoom/2)+10*sin(on/4)':y='ih/2-(ih/zoom/2)+10*cos(on/4)'${zdur}`,
        'mov-pop-up': `zoompan=z='min(1.0 + ${onNorm}*5, 1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-bounce-drop': `zoompan=z='1.0':y='(ih/2-(ih/zoom/2)) + (ih/2 * abs(cos(${onNorm}*5*PI)) * (1-${onNorm}))'${zdur}`
    };

    const selectedFilter = moves[moveId] || moves['kenburns'];
    return `${pre},${selectedFilter},${post}`;
}
