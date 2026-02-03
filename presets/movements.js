
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
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

    // --- FILTROS DE BLUR AUXILIARES ---
    const blurIn = `,boxblur=20:1:enable='lt(t,0.5)',boxblur=10:1:enable='between(t,0.5,1.0)',boxblur=5:1:enable='between(t,1.0,1.5)',boxblur=2:1:enable='between(t,1.5,2.0)'`;
    const blurOut = `,boxblur=2:1:enable='between(t,${d-2.0},${d-1.5})',boxblur=5:1:enable='between(t,${d-1.5},${d-1.0})',boxblur=10:1:enable='between(t,${d-1.0},${d-0.5})',boxblur=20:1:enable='gt(t,${d-0.5})'`;
    const pulseBlur = `,boxblur=15:1:enable='between(mod(t,3),0,0.2)'`;

    const moves = {
        // --- 1. ESTÁTICO & SUAVE ---
        'static': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'kenburns': `zoompan=z='min(1.2, 1.0+0.001*on)':x='(iw/2-(iw/zoom/2))':y='(ih/2-(ih/zoom/2))'${zdur}`,
        
        // Flutuar (Float) - VERSÃO ULTRA (High Intensity):
        // Zoom base 1.5 para permitir balanço amplo. Amplitude X: 150px, Y: 80px.
        // Ciclos mais rápidos (divisores 70/90) para curva visível em vídeos curtos.
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
        // TL: Top-Left (Cima Esquerda) -> X diminui, Y diminui
        'mov-pan-diag-tl': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) - (iw/8 * ${p_zoom})':y='(ih/2-(ih/zoom/2)) - (ih/8 * ${p_zoom})'${zdur}`,
        // TR: Top-Right (Cima Direita) -> X aumenta, Y diminui
        'mov-pan-diag-tr': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) + (iw/8 * ${p_zoom})':y='(ih/2-(ih/zoom/2)) - (ih/8 * ${p_zoom})'${zdur}`,
        // BL: Bottom-Left (Baixo Esquerda) -> X diminui, Y aumenta
        'mov-pan-diag-bl': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) - (iw/8 * ${p_zoom})':y='(ih/2-(ih/zoom/2)) + (ih/8 * ${p_zoom})'${zdur}`,
        // BR: Bottom-Right (Baixo Direita) -> X aumenta, Y aumenta
        'mov-pan-diag-br': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) + (iw/8 * ${p_zoom})':y='(ih/2-(ih/zoom/2)) + (ih/8 * ${p_zoom})'${zdur}`,

        // --- 4. BLUR & FOCO ---
        'mov-blur-in': `zoompan=z='min(1.15, 1.0+0.001*on)'${zdur}${blurIn}`,
        'mov-blur-out': `zoompan=z='min(1.15, 1.0+0.001*on)'${zdur}${blurOut}`,
        'mov-blur-pulse': `zoompan=z='1.05+0.02*sin(on/30)'${zdur}${pulseBlur}`,
        
        // Tilt Shift: Vignette + Blur nas bordas (simulado com boxblur geral leve + vignette forte)
        'mov-tilt-shift': `zoompan=z=1.1${zdur},boxblur=2:1,vignette=a=PI/4`,

        // --- 5. EFEITOS ESPECIAIS & MOVIMENTO REALISTA ---
        'handheld-1': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+8*sin(on/15)':y='ih/2-(ih/zoom/2)+8*cos(on/18)'${zdur}`,
        'earthquake': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+20*sin(on*50)':y='ih/2-(ih/zoom/2)+20*cos(on*43)'${zdur}`,
        
        // --- 6. GLITCH & CAOS ---
        // RGB Shift Move: Movimento ondulante + alteração de cor
        'mov-rgb-shift-move': `zoompan=z='1.1+0.05*sin(on/15)'${zdur},hue=h='20*sin(10*t)'`,
        
        // Snap Glitch: Zoom rápido "quadrado" + Ruído
        'mov-glitch-snap': `zoompan=z='if(gt(sin(on/5),0.9), 1.4, 1.05)'${zdur},noise=alls=20:allf=t`,
        
        // Glitch Skid: Movimento lateral rápido e curto (jitter) + Desfoque de movimento
        'mov-glitch-skid': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)+30*sin(on*20)':y='ih/2-(ih/zoom/2)'${zdur},boxblur=4:1`,
        
        // Shake Violento: Movimento rápido + Blur forte
        'mov-shake-violent': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)+60*sin(on*10)':y='ih/2-(ih/zoom/2)+60*cos(on*12)'${zdur},boxblur=10:1`,
        
        // Vibração Sônica: Micro-vibração vertical
        'mov-vibrate': `zoompan=z=1.1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)+10*sin(on*50)'${zdur},boxblur=2:1`,

        // --- 7. ELÁSTICO & DIVERTIDO (CORRIGIDO FINAL) ---

        // Zoom Wobble: O foco oscila e a câmera "dança" levemente de um lado pro outro.
        'mov-zoom-wobble': `zoompan=z='1.25+0.02*sin(on/30)':x='iw/2-(iw/zoom/2)+40*sin(on/20)':y='ih/2-(ih/zoom/2)+30*cos(on/25)'${zdur}`,

        // Gelatina (Jelly Wobble):
        'mov-jelly-wobble': `zoompan=z='1.2+0.03*sin(on/15)':x='iw/2-(iw/zoom/2)+30*sin(on/10)':y='ih/2-(ih/zoom/2)+30*cos(on/12)'${zdur},boxblur=2:1`,

        // Elástico (Rubber Band)
        'mov-rubber-band': `zoompan=z='1.0+0.3*abs(sin(on/15))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,

        // Pop Up
        'mov-pop-up': `zoompan=z='min(1.2, 1.0+(on/10)*0.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,

        // Bounce Drop
        'mov-bounce-drop': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2) - 150*cos(on/5)/(1+on*0.1)'${zdur}`
    };

    const selectedFilter = moves[moveId] || moves['kenburns'];
    // Force even output dimensions
    const post = `scale=trunc(${targetW}/2)*2:trunc(${targetH}/2)*2:flags=lanczos,setsar=1,fps=${fps},format=yuv420p`;
    
    return `${pre},${selectedFilter},${post}`;
}
