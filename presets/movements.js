
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
        'mov-3d-float': `zoompan=z='1.5+0.05*sin(on/80)':x='iw/2-(iw/zoom/2)+150*sin(on/70)':y='ih/2-(ih/zoom/2)+80*cos(on/90)'${zdur}`,
        
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
        'mov-pan-fast-l': `zoompan=z=1.2:x='(iw/2-(iw/zoom/2)) + (iw/3 * ${p_zoom})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-fast-r': `zoompan=z=1.2:x='(iw/2-(iw/zoom/2)) - (iw/3 * ${p_zoom})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-diag-tl': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) - (iw/8 * ${p_zoom})':y='(ih/2-(ih/zoom/2)) - (ih/8 * ${p_zoom})'${zdur}`,
        'mov-pan-diag-br': `zoompan=z=1.5:x='(iw/2-(iw/zoom/2)) + (iw/8 * ${p_zoom})':y='(ih/2-(ih/zoom/2)) + (ih/8 * ${p_zoom})'${zdur}`,

        // --- 4. BLUR & FOCO ---
        'mov-blur-in': `zoompan=z='min(1.15, 1.0+0.001*on)'${zdur}${blurIn}`,
        'mov-blur-out': `zoompan=z='min(1.15, 1.0+0.001*on)'${zdur}${blurOut}`,
        'mov-blur-pulse': `zoompan=z='1.05+0.02*sin(on/30)'${zdur}${pulseBlur}`,
        'mov-tilt-shift': `zoompan=z=1.1${zdur},boxblur=2:1,vignette=a=PI/4`,

        // --- 5. REALISMO & CÂMERA ---
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
        'mov-bounce-drop': `zoompan=z=1.3:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2) - 150*cos(on/5)/(1+on*0.1)'${zdur}`,

        // --- 8. 3D & ROTAÇÃO (NOVOS) ---
        // Simulações 2D/3D usando Rotate e ZoomPan
        
        // Rolamento (Roll): Rotação contínua no eixo Z
        'mov-3d-roll': `zoompan=z=1.4:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur},rotate=a='t*0.5':c=black@0`,
        
        // Pêndulo (Swing): Rotação oscilante suave
        'mov-3d-swing-l': `zoompan=z=1.4:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur},rotate=a='0.15*sin(2*PI*t/4)':c=black@0`,
        'mov-3d-swing-r': `zoompan=z=1.4:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur},rotate=a='-0.15*sin(2*PI*t/4)':c=black@0`,

        // 3D Spin (Eixo Y): Simulado com zoom pulsante e pan lateral sincronizado (efeito de "respiração" 3D)
        'mov-3d-spin-axis': `zoompan=z='1.3+0.2*cos(2*PI*on/(fps*3))':x='iw/2-(iw/zoom/2) + (iw/4)*sin(2*PI*on/(fps*3))':y='ih/2-(ih/zoom/2)'${zdur}`,

        // 3D Flip X (Cambalhota): Simulado com scan vertical rápido
        'mov-3d-flip-x': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2) + (ih/3)*cos(2*PI*on/(fps*2))'${zdur}`,

        // 3D Flip Y (Giro): Simulado com scan horizontal rápido
        'mov-3d-flip-y': `zoompan=z=1.5:x='iw/2-(iw/zoom/2) + (iw/3)*cos(2*PI*on/(fps*2))':y='ih/2-(ih/zoom/2)'${zdur}`
    };

    const selectedFilter = moves[moveId] || moves['kenburns'];
    // Force even output dimensions
    const post = `scale=trunc(${targetW}/2)*2:trunc(${targetH}/2)*2:flags=lanczos,setsar=1,fps=${fps},format=yuv420p`;
    
    return `${pre},${selectedFilter},${post}`;
}
