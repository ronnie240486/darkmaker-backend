
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const fps = 30; 
    const totalFrames = Math.ceil(d * fps);
    
    // ==========================================================================================
    // PRE-SCALE 2x: Otimizado para performance e qualidade
    // ==========================================================================================
    const pre = `scale=${targetW*2}:${targetH*2}:force_original_aspect_ratio=increase,crop=${targetW*2}:${targetH*2},setsar=1`;
    
    // Zoompan Base Config
    const zdur = `:d=${totalFrames*2}:s=${targetW}x${targetH}:fps=${fps}`;
    const p_zoom = `(on/${totalFrames})`; 

    // --- FILTROS DE BLUR AUXILIARES ---
    // Safe Blurs usando expressões de tempo simples
    const blurIn = `,boxblur=20:1:enable='lt(t,0.5)',boxblur=10:1:enable='between(t,0.5,1.0)',boxblur=5:1:enable='between(t,1.0,1.5)',boxblur=2:1:enable='between(t,1.5,2.0)'`;
    const blurOut = `,boxblur=2:1:enable='between(t,${d-2.0},${d-1.5})',boxblur=5:1:enable='between(t,${d-1.5},${d-1.0})',boxblur=10:1:enable='between(t,${d-1.0},${d-0.5})',boxblur=20:1:enable='gt(t,${d-0.5})'`;
    const pulseBlur = `,boxblur=20:1:enable='between(mod(t,3),0,0.2)'`; // Blur forte e rápido

    const moves = {
        // --- 1. ESTÁTICO & SUAVE ---
        'static': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'kenburns': `zoompan=z='min(1.2, 1.0+0.001*on)':x='(iw/2-(iw/zoom/2))':y='(ih/2-(ih/zoom/2))'${zdur}`,
        'mov-3d-float': `zoompan=z='1.05+0.03*sin(on/80)':x='iw/2-(iw/zoom/2)+10*sin(on/60)':y='ih/2-(ih/zoom/2)+10*cos(on/70)'${zdur}`,
        
        'mov-tilt-up-slow': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/10 * ${p_zoom})'${zdur}`,
        'mov-tilt-down-slow': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/10 * ${p_zoom})'${zdur}`,

        // --- 2. ZOOM DINÂMICO ---
        'zoom-in': `zoompan=z='min(1.5, 1.0+(0.5*${p_zoom}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'zoom-out': `zoompan=z='max(1.0, 1.5-(0.5*${p_zoom}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-crash-in': `zoompan=z='min(3, 1.0+0.1*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-dolly-vertigo': `zoompan=z='1.0+(0.4*${p_zoom})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        
        // --- 3. PANORÂMICAS ---
        'mov-pan-slow-l': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) + (iw/8 * ${p_zoom})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-r': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) - (iw/8 * ${p_zoom})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-u': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/8 * ${p_zoom})'${zdur}`,
        'mov-pan-slow-d': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/8 * ${p_zoom})'${zdur}`,

        // --- 4. BLUR & FOCO ---
        'mov-blur-in': `zoompan=z='min(1.15, 1.0+0.001*on)'${zdur}${blurIn}`,
        'mov-blur-out': `zoompan=z='min(1.15, 1.0+0.001*on)'${zdur}${blurOut}`,
        'mov-blur-pulse': `zoompan=z='1.05+0.02*sin(on/30)'${zdur}${pulseBlur}`,
        
        // Tilt Shift: Focado no centro, borrado e escuro nas bordas
        'mov-tilt-shift': `zoompan=z=1.1${zdur},boxblur=5:1,vignette=a=PI/3`,

        // --- 5. EFEITOS ESPECIAIS & MOVIMENTO REALISTA ---
        'handheld-1': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+8*sin(on/15)':y='ih/2-(ih/zoom/2)+8*cos(on/18)'${zdur}`,
        'earthquake': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+20*sin(on*5)':y='ih/2-(ih/zoom/2)+20*cos(on*7)'${zdur}`,
        
        // --- 6. GLITCH & CAOS (CORRIGIDO: MATEMÁTICA SEGURA + DESFOQUE REAL) ---
        
        // RGB Shift Move (Simulado):
        // Usa hue dinâmico rápido para oscilar cores + desfoque leve constante para "digital feel"
        'mov-rgb-shift-move': `zoompan=z='1.1+0.05*sin(on/5)'${zdur},hue=h='20*sin(10*t)',boxblur=2:1`,
        
        // Snap Glitch:
        // Usa ondas quadradas (sin > 0) para saltos bruscos.
        // Adiciona Noise pesado e Blur forte SÓ quando o salto acontece.
        'mov-glitch-snap': `zoompan=z='if(gt(sin(on/5),0.9), 1.5, 1.05)'${zdur},noise=alls=20:allf=t,boxblur=20:2:enable='gt(sin(t*6),0.9)'`,
        
        // Glitch Skid:
        // Deslocamento lateral rápido em loop + ruído.
        'mov-glitch-skid': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+100*sin(on*2)'${zdur},noise=alls=10:allf=t`,
        
        // Shake Violento:
        // Alta amplitude, alta frequência nas coordenadas X/Y.
        // Adicionado boxblur CONSTANTE para simular motion blur de alta velocidade.
        'mov-shake-violent': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)+60*sin(on)':y='ih/2-(ih/zoom/2)+60*cos(on*1.1)'${zdur},boxblur=10:1`,
        
        // Vibração Sônica:
        // Micro-movimentos ultra rápidos + desfoque vertical
        'mov-vibrate': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+10*sin(on*10)'${zdur},boxblur=2:1`
    };

    const selectedFilter = moves[moveId] || moves['kenburns'];
    const post = `scale=${targetW}:${targetH}:flags=lanczos,setsar=1,fps=${fps},format=yuv420p`;
    
    return `${pre},${selectedFilter},${post}`;
}
