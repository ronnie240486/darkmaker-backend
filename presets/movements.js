
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const fps = 24; 
    const totalFrames = Math.ceil(d * fps); // Frames totais
    
    // ==========================================================================================
    // CORREÇÃO DE SEGURANÇA 1: Pre-scale com Padding
    // Redimensiona a imagem antes do zoom para garantir que temos pixels suficientes.
    // Usamos 'setsar=1' para evitar erros de Aspect Ratio.
    // ==========================================================================================
    const pre = `scale=${targetW*2}:${targetH*2}:force_original_aspect_ratio=increase,crop=${targetW*2}:${targetH*2},setsar=1`;
    
    // Zoompan duration settings
    // s=${targetW}x${targetH} -> Garante que a saída do zoompan seja EXATAMENTE o tamanho alvo
    const zdur = `:d=${totalFrames*2}:s=${targetW}x${targetH}:fps=${fps}`;
    
    // Variáveis de Tempo Simplificadas para estabilidade do FFmpeg
    // on: Output Frame Number
    // time: Tempo em segundos
    // duration: Duração total
    
    // Normalização (0.0 a 1.0) usando frame number (on)
    // Usamos 'on' em vez de 'n' porque 'zoompan' reinicia o count para cada filtro
    const p = `(on/${totalFrames})`; 

    const moves = {
        // --- 1. ESTÁTICO & SUAVE (Safe) ---
        'static': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'kenburns': `zoompan=z='min(1.5, 1.0+0.0015*on)':x='(iw/2-(iw/zoom/2))':y='(ih/2-(ih/zoom/2))'${zdur}`,
        'mov-3d-float': `zoompan=z='1.1+0.05*sin(on/50)':x='iw/2-(iw/zoom/2)+10*sin(on/40)':y='ih/2-(ih/zoom/2)+10*cos(on/50)'${zdur}`,
        
        'mov-tilt-up-slow': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/4 * ${p})'${zdur}`,
        'mov-tilt-down-slow': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/4 * ${p})'${zdur}`,

        // --- 2. ZOOM DINÂMICO (Clamped) ---
        // Adicionado 'min' e 'max' para evitar zoom infinito ou negativo
        'zoom-in': `zoompan=z='min(2.0, 1.0+(on/${totalFrames}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'zoom-out': `zoompan=z='max(1.0, 2.0-(on/${totalFrames}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        
        'mov-zoom-crash-in': `zoompan=z='min(4, 1.0+0.1*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-dolly-vertigo': `zoompan=z='1.0+(0.5*${p})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        
        // --- 3. PANORÂMICAS "EMPURRAR" (Crash-Proof) ---
        // O segredo aqui é o Zoom Base de 1.5. Se for 1.0, mover X/Y cria barras pretas e pode crashar.
        // x e y são calculados do CENTRO.
        'mov-pan-slow-l': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) + (iw/4 * ${p})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-r': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) - (iw/4 * ${p})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-u': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/4 * ${p})'${zdur}`,
        'mov-pan-slow-d': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/4 * ${p})'${zdur}`,

        // --- 4. BLUR & FOCO (Fixed) ---
        // O erro anterior era no cálculo dinâmico do raio do boxblur.
        // Solução: Usar 'gblur' (Gaussian Blur) com sigma controlado ou 'unsharp'.
        // Se boxblur for usado, o raio deve ser fixo ou muito simples.
        
        // Blur In: Começa desfocado e foca. 
        // Usamos interpolação simples: lr = 40 - (40 * progress).
        // Importante: max(0, ...) protege contra valores negativos.
        'mov-blur-in': `zoompan=z=1.1${zdur},boxblur=lr='max(0, 20-(20*${p}))':lp=2`,
        
        // Blur Out: Começa focado e desfoca.
        'mov-blur-out': `zoompan=z=1.1${zdur},boxblur=lr='max(0, 20*${p})':lp=2`,
        
        // Pulse Blur: Pulsa o desfoque
        'mov-blur-pulse': `zoompan=z=1.1${zdur},boxblur=lr='max(0, 10*sin(on/10))':lp=1`,
        
        // Tilt Shift: Usa blur fixo nas bordas (Vignette) e no centro (Boxblur light)
        'mov-tilt-shift': `zoompan=z=1.1${zdur},boxblur=lr=2:lp=1,vignette=a=PI/5`,

        // --- 5. EFEITOS ESPECIAIS ---
        'handheld-1': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+10*sin(on/10)':y='ih/2-(ih/zoom/2)+10*cos(on/12)'${zdur}`,
        'earthquake': `zoompan=z=1.2:x='iw/2-(iw/zoom/2)+30*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+30*(random(1)-0.5)'${zdur}`,
        'mov-vibrate': `zoompan=z=1.05:x='iw/2-(iw/zoom/2)+4*sin(on*20)':y='ih/2-(ih/zoom/2)+4*cos(on*20)'${zdur}`,
        
        'mov-rgb-shift-move': `zoompan=z=1.05${zdur},rgbashift=rh=15:bv=15`,
        'mov-glitch-snap': `zoompan=z='if(mod(on,24)<2, 1.2, 1.0)'${zdur},noise=alls=20:allf=t`
    };

    const selectedFilter = moves[moveId] || moves['kenburns'];
    
    // Força o formato de pixel e frame rate no final para evitar erros de concatenação
    const post = `scale=${targetW}:${targetH}:flags=lanczos,setsar=1,fps=${fps},format=yuv420p`;
    
    return `${pre},${selectedFilter},${post}`;
}
