
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720, config = {}) {
    const d = parseFloat(durationSec) || 5;
    const fps = 24; 
    const totalFrames = Math.ceil(d * fps);
    
    // ==========================================================================================
    // CONFIGURAÇÃO BASE
    // Upscale agressivo (2x ou 4x) para garantir que zooms e rotações não criem bordas pretas
    // ==========================================================================================
    const preProcess = `scale=${targetW*3}:${targetH*3}:force_original_aspect_ratio=increase,crop=${targetW*3}:${targetH*3},setsar=1`;
    const postProcess = `scale=${targetW}:${targetH}:flags=lanczos,fps=${fps},format=yuv420p`;
    
    // Zoom base para permitir movimento de câmera (Handheld) sem bordas pretas
    // O canvas de trabalho é 3x maior, então zoom=1.0 é gigante.
    // Usaremos zoom relativo onde 0.333 seria o tamanho original (fit).
    // Para simplificar, trabalhamos com coordenadas relativas ao canvas gigante.

    // Duração padrão para o zoompan
    const zpDur = `:d=${totalFrames}:fps=${fps}:s=${targetW}x${targetH}`;

    // Variáveis auxiliares de tempo (normalizadas 0 a 1)
    const t = `(on/${totalFrames})`; // Tempo linear 0 -> 1
    const t_pi = `(on/${totalFrames}*PI)`; 
    const t_sin = `sin(${t}*PI)`; // Sobe e desce suave

    let filterChain = "";

    switch (moveId) {
        // =================================================================
        // 1. DINÂMICA FÍSICA & ELÁSTICA (Bounciness & Physics)
        // =================================================================
        
        case 'mov-rubber-band': // Efeito Elástico Real (Vai e volta rápido com amortecimento)
            // Zoom oscila: Entra rápido, passa do ponto, volta.
            // Fórmula: 1 + (amplitude * sin(freq * t) * decay)
            filterChain = `zoompan=z='1.5 + 0.3*sin(on/10)*exp(-on/${totalFrames/3})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'mov-jelly-wobble': // Gelatina (Oscilação Líquida X e Y e Zoom)
            // O centro X e Y oscilam em frequências diferentes criando distorção de movimento
            filterChain = `zoompan=z='1.2 + 0.05*sin(on/5)':x='iw/2-(iw/zoom/2) + (iw/zoom/10)*sin(on/8)':y='ih/2-(ih/zoom/2) + (ih/zoom/10)*cos(on/10)'${zpDur}`;
            break;

        case 'mov-bounce-drop': // Queda com Quique (Gravidade)
            // Simula um objeto caindo e quicando no chão
            // Y varia com abs(cos) para fazer o quique
            filterChain = `zoompan=z='1.2':x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/4)*abs(cos(on/15))*exp(-on/${totalFrames/2})'${zpDur}`;
            break;

        case 'mov-pop-up': // Pop Up (Crescimento Explosivo com Overshoot)
            // Zoom vai de 1.0 a 1.6 rapidíssimo e estabiliza em 1.5
            filterChain = `zoompan=z='if(lte(on,20), 1.0+(0.6*on/20), 1.5 + 0.1*sin((on-20)/5)*exp(-(on-20)/20))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'mov-scale-pulse': // Pulso Cardíaco
            filterChain = `zoompan=z='1.3 + 0.1*sin(on/3)*sin(on/3)*sin(on/3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        // =================================================================
        // 2. CÂMERA DE MÃO & REALISMO (Handheld & Shake)
        // =================================================================

        case 'handheld-1': // Vlog Leve
            // Perlin Noise Simulado: Soma de Senos com frequências primas (13, 17) para evitar repetição
            filterChain = `zoompan=z='1.2':x='iw/2-(iw/zoom/2) + (iw/50)*sin(on/13) + (iw/100)*cos(on/29)':y='ih/2-(ih/zoom/2) + (ih/50)*cos(on/17) + (ih/100)*sin(on/31)'${zpDur}`;
            break;

        case 'handheld-2': // Corrida / Ação
            filterChain = `zoompan=z='1.3':x='iw/2-(iw/zoom/2) + (iw/30)*sin(on/5)':y='ih/2-(ih/zoom/2) + (ih/20)*abs(sin(on/4))'${zpDur}`;
            break;

        case 'mov-walk': // Caminhada (Balanço rítmico Y + leve X)
            filterChain = `zoompan=z='1.2':x='iw/2-(iw/zoom/2) + (iw/80)*sin(on/24)':y='ih/2-(ih/zoom/2) + (ih/40)*abs(sin(on/12))'${zpDur}`;
            break;

        case 'earthquake': // Terremoto (Vibração Caótica)
            // Usa 'random(1)' para caos total frame a frame
            filterChain = `zoompan=z='1.1':x='iw/2-(iw/zoom/2) + (random(1)-0.5)*(iw/10)':y='ih/2-(ih/zoom/2) + (random(1)-0.5)*(ih/10)'${zpDur}`;
            break;

        case 'mov-jitter-x': // Tremor Horizontal (Tensão)
            filterChain = `zoompan=z='1.2':x='iw/2-(iw/zoom/2) + (iw/20)*sin(on*10)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        // =================================================================
        // 3. 3D & ROTAÇÃO (Spin, Roll, Perspective)
        // =================================================================

        case 'mov-3d-roll': // Rolamento de Câmera (Dutch Angle)
            // Rotação real usando filtro 'rotate' + zoom para cobrir bordas pretas
            // Rotação senoidal suave de -5 a +5 graus
            filterChain = `rotate=angle='5*PI/180*sin(t*2)':fillcolor=black,zoompan=z='1.4':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'mov-3d-spin-axis': // Giro Completo Lento (Vortex)
            filterChain = `rotate=angle='t*0.5':ow='iw':oh='ih',zoompan=z='1.8':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'mov-3d-swing-l': // Pêndulo
            filterChain = `rotate=angle='15*PI/180*sin(t*3)':fillcolor=black,zoompan=z='1.5':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        // =================================================================
        // 4. GLITCH & CAOS DIGITAL
        // =================================================================

        case 'mov-glitch-snap': // Pulos de Corte
            // Zoom muda bruscamente a cada 10 frames
            filterChain = `zoompan=z='if(eq(mod(on,10),0), 1.5, 1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'mov-rgb-shift-move': // RGB Split Simulado (Vibração Rápida)
            // Simula RGB shift tremendo muito rápido
            filterChain = `zoompan=z='1.05':x='iw/2-(iw/zoom/2) + if(eq(mod(on,2),0), 10, -10)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        // =================================================================
        // 5. FOCO & BLUR (Efeitos Óticos)
        // =================================================================

        case 'mov-blur-pulse': // Pulso de Desfoque
            // Aplica boxblur que varia com o tempo (sinusoidal)
            // Zoom suave de fundo
            filterChain = `boxblur=luma_radius='20*abs(sin(t*3))':luma_power=1,zoompan=z='1.1':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'mov-blur-in': // Fica Focado (Começa borrado)
            filterChain = `boxblur=luma_radius='20*(1-t/T)':luma_power=1,zoompan=z='1.0+0.1*on/${totalFrames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        // =================================================================
        // 6. ZOOMS & PANS CLÁSSICOS (Corrigidos e Suaves)
        // =================================================================

        case 'zoom-in': // Zoom In Dinâmico (Acelera)
            // t*t cria curva exponencial (suave no começo, rápido no fim)
            filterChain = `zoompan=z='1.0 + 2.0*(${t}*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'zoom-out': // Zoom Out Dinâmico
            filterChain = `zoompan=z='3.0 - 2.0*(${t}*${t})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'mov-zoom-crash-in': // Crash Zoom (Impacto)
            // Zoom extremo linear
            filterChain = `zoompan=z='1.0 + 4.0*${t}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        case 'mov-pan-fast-l': // Pan Rápido (Whip Pan)
            // Curva S-Curve para suavizar inicio e fim do Pan
            // X se move rápido
            filterChain = `zoompan=z='1.2':x='(iw-iw/zoom)*(1-(${t}*${t}*(3-2*${t})))':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;

        // PADRÃO: Ken Burns Suave (Estático melhorado)
        case 'static':
        case 'kenBurns':
        default:
            // Movimento lento e imperceptível para dar vida
            filterChain = `zoompan=z='1.0 + 0.15*${t}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zpDur}`;
            break;
    }

    // Retorna a cadeia completa
    return `${preProcess},${filterChain},${postProcess}`;
}
