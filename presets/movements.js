
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    // Adiciona 2 segundos extras no cálculo do filtro para evitar "tela preta" no final
    const d = parseFloat(durationSec) + 2; 
    const fps = 30; // Aumentado para 30fps para suavidade
    const totalFrames = Math.ceil(d * fps);
    
    // ==========================================================================================
    // CORREÇÃO CRÍTICA: Pre-scale com Padding Gigante
    // Redimensiona a imagem para 4x o tamanho alvo antes do zoom.
    // Isso garante qualidade mesmo com Zoom 2.0 ou 3.0.
    // ==========================================================================================
    const pre = `scale=${targetW*4}:${targetH*4}:force_original_aspect_ratio=increase,crop=${targetW*4}:${targetH*4},setsar=1`;
    
    // Configuração do Zoompan
    // d=... define a duração em frames. Multiplicamos por 2 para segurança total.
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
        
        'mov-tilt-up-slow': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/6 * ${p})'${zdur}`,
        'mov-tilt-down-slow': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/6 * ${p})'${zdur}`,

        // --- 2. ZOOM DINÂMICO (Clamped & Safe) ---
        'zoom-in': `zoompan=z='min(2.5, 1.0+(1.5*${p}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'zoom-out': `zoompan=z='max(1.0, 2.5-(1.5*${p}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        
        'mov-zoom-crash-in': `zoompan=z='min(4, 1.0+0.15*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-dolly-vertigo': `zoompan=z='1.0+(0.8*${p})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        
        // --- 3. PANORÂMICAS "EMPURRAR" (CRASH PROOF - ZOOM 2.0) ---
        // Aumentamos o Zoom base para 2.0.
        // A imagem é cortada pela metade, permitindo mover a câmera livremente pela outra metade.
        // Isso impede o erro "Invalid Argument" causado por coordenadas fora da imagem.
        'mov-pan-slow-l': `zoompan=z=2.0:x='(iw/2-(iw/zoom/2)) + (iw/5 * ${p})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-r': `zoompan=z=2.0:x='(iw/2-(iw/zoom/2)) - (iw/5 * ${p})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-u': `zoompan=z=2.0:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/5 * ${p})'${zdur}`,
        'mov-pan-slow-d': `zoompan=z=2.0:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/5 * ${p})'${zdur}`,

        // --- 4. BLUR & FOCO (Fixed Math) ---
        // Usamos lrp (Linear Interpolation) fixo no boxblur.
        // max(0, val) garante que nunca seja negativo.
        // min(50, val) garante que não exploda a memória.
        'mov-blur-in': `zoompan=z=1.1${zdur},boxblur=lr='min(50, max(0, 40-(40*${p})))':lp=2`,
        'mov-blur-out': `zoompan=z=1.1${zdur},boxblur=lr='min(50, max(0, 40*${p}))':lp=2`,
        'mov-blur-pulse': `zoompan=z=1.1${zdur},boxblur=lr='min(20, max(0, 10*sin(on/15)))':lp=1`,
        'mov-tilt-shift': `zoompan=z=1.1${zdur},boxblur=lr=2:lp=1,vignette=a=PI/5`,

        // --- 5. EFEITOS ESPECIAIS ---
        'handheld-1': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)+15*sin(on/8)':y='ih/2-(ih/zoom/2)+15*cos(on/10)'${zdur}`,
        'earthquake': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)+40*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+40*(random(1)-0.5)'${zdur}`,
        
        'mov-rgb-shift-move': `zoompan=z=1.1${zdur},rgbashift=rh=10:bv=10`,
        'mov-glitch-snap': `zoompan=z='if(mod(on,30)<3, 1.3, 1.0)'${zdur},noise=alls=10:allf=t`
    };

    const selectedFilter = moves[moveId] || moves['kenburns'];
    
    // Pós-processamento para garantir formato final
    const post = `scale=${targetW}:${targetH}:flags=lanczos,setsar=1,fps=${fps},format=yuv420p`;
    
    return `${pre},${selectedFilter},${post}`;
}
