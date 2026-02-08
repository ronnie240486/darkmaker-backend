
const presetGenerator = require('./presetGenerator.js');

// Helper to escape text for drawtext filter
function escapeDrawText(text) {
    if (!text) return '';
    return text
        .replace(/\\/g, '\\\\')
        .replace(/:/g, '\\:')
        .replace(/'/g, "\\'")
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]');
}

// Helper to wrap text manually since drawtext wrapping can be finicky
function wrapText(text, maxCharsPerLine) {
    if (!text) return '';
    const words = text.split(' ');
    let lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        if (currentLine.length + 1 + words[i].length <= maxCharsPerLine) {
            currentLine += ' ' + words[i];
        } else {
            lines.push(currentLine);
            currentLine = words[i];
        }
    }
    lines.push(currentLine);
    return lines.join('\n');
}

module.exports = {
    buildTimeline: (clips, fileMap, mediaLibrary, exportConfig = {}) => {
        let inputs = [];
        let filterChain = '';
        
        let inputIndexCounter = 0;

        // --- CONFIGURAÇÃO DE RESOLUÇÃO E FPS ---
        const resMap = {
            '720p': { w: 1280, h: 720 },
            '1080p': { w: 1920, h: 1080 },
            '4k': { w: 3840, h: 2160 }
        };
        
        const targetRes = resMap[exportConfig.resolution] || resMap['720p'];
        const targetFps = exportConfig.fps || 30;
        
        // Filtro de Escala Seguro: Força resolução par e preenche com barras pretas se necessário (Letterbox)
        const SCALE_FILTER = `scale=${targetRes.w}:${targetRes.h}:force_original_aspect_ratio=decrease,pad=${targetRes.w}:${targetRes.h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${targetFps},format=yuv420p`;

        // SEPARAR TRILHAS
        // Video Principal (Base para transições xfade)
        const mainTrackClips = clips.filter(c => 
            c.track === 'video' || (c.track === 'camada' && c.type === 'video') 
        ).sort((a, b) => a.start - b.start);

        // Overlays (Texto, Imagens Sobrepostas, Legendas)
        const overlayClips = clips.filter(c => 
            ['text', 'subtitle'].includes(c.track) || (c.track === 'camada' && c.type === 'image')
        );

        // Audio Clips
        const audioClips = clips.filter(c => 
            ['audio', 'narration', 'music', 'sfx'].includes(c.track) ||
            (c.type === 'audio' && !['video', 'camada', 'text'].includes(c.track))
        );

        let mainTrackLabels = [];
        let baseAudioSegments = [];
        
        // Filtros globais pós-mixagem (ex: glitch global durante transição)
        let globalPostFilters = [];

        // --- 1. CONSTRUIR TRILHA DE VÍDEO PRINCIPAL (Sequência com Transições) ---
        
        if (mainTrackClips.length === 0) {
            // Fundo preto padrão se não houver vídeo
            inputs.push('-f', 'lavfi', '-t', '5', '-i', `color=c=black:s=${targetRes.w}x${targetRes.h}:r=${targetFps}`);
            mainTrackLabels.push(`[${inputIndexCounter++}:v]`);
            // Áudio mudo padrão
             inputs.push('-f', 'lavfi', '-t', '5', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
             baseAudioSegments.push(`[${inputIndexCounter++}:a]`);
        } else {
             mainTrackClips.forEach((clip, i) => {
                const filePath = fileMap[clip.fileName];
                if (!filePath && clip.type !== 'text') return; 

                // Garantir duração mínima para xfade não falhar
                const duration = Math.max(0.5, parseFloat(clip.duration) || 5);

                // --- INPUT ---
                if (clip.type === 'image') {
                    // Imagens precisam de loop e duração explícita no input para performance
                    inputs.push('-loop', '1', '-t', (duration + 1).toString(), '-i', filePath); 
                } else {
                    inputs.push('-i', filePath);
                }

                const idx = inputIndexCounter++;
                let currentV = `[${idx}:v]`;
                
                const addFilter = (filterText) => {
                    if (!filterText) return;
                    const nextLabel = `vtmp${i}_${Math.random().toString(36).substr(2, 5)}`;
                    filterChain += `${currentV}${filterText}[${nextLabel}];`;
                    currentV = `[${nextLabel}]`;
                };

                // 1. ESCALA INICIAL (Padronizar tamanho)
                addFilter(SCALE_FILTER);

                // 2. CORTE (TRIM)
                if (clip.type !== 'image') {
                    const start = clip.mediaStartOffset || 0;
                    addFilter(`trim=start=${start}:duration=${start + duration},setpts=PTS-STARTPTS`);
                } else {
                    // Para imagem, já limitamos no input, mas setpts garante timestamp zero
                    addFilter(`trim=duration=${duration},setpts=PTS-STARTPTS`);
                }
                
                // --- SPECIAL TRANSITION PRE-PROCESSING (NEGATIVE EFFECT) ---
                // If this clip is the 'incoming' clip of a zoom-neg transition, invert its colors for the transition duration.
                if (clip.transition && clip.transition.id === 'zoom-neg') {
                    const transDur = clip.transition.duration || 0.5;
                    // Invert colors (negate) only during the transition entry period
                    addFilter(`negate=enable='between(t,0,${transDur})'`);
                }

                // 3. EFEITOS DE COR (Filtros)
                if (clip.effect) {
                    const fx = presetGenerator.getFFmpegFilterFromEffect(clip.effect);
                    if (fx) addFilter(fx);
                }
                
                // Ajustes Manuais de Cor (Brightness, Contrast, etc.)
                if (clip.properties && clip.properties.adjustments) {
                    const adj = clip.properties.adjustments;
                    let eqParts = [];
                    if (adj.brightness !== 1) eqParts.push(`brightness=${(adj.brightness - 1).toFixed(2)}`);
                    if (adj.contrast !== 1) eqParts.push(`contrast=${adj.contrast.toFixed(2)}`);
                    if (adj.saturate !== 1) eqParts.push(`saturation=${adj.saturate.toFixed(2)}`);
                    
                    let eqFilter = eqParts.length > 0 ? `eq=${eqParts.join(':')}` : '';
                    if (adj.hue !== 0) {
                         eqFilter = eqFilter ? `${eqFilter},hue=h=${adj.hue}` : `hue=h=${adj.hue}`;
                    }
                    if (eqFilter) addFilter(eqFilter);
                }

                // 4. MOVIMENTO (Zoom/Pan/KenBurns)
                // Passa a resolução alvo para o presetGenerator para evitar downscaling acidental
                if (clip.properties && clip.properties.movement) {
                    const moveFilter = presetGenerator.getMovementFilter(clip.properties.movement.type, duration, clip.type === 'image', clip.properties.movement.config, targetRes, targetFps);
                    if (moveFilter) addFilter(moveFilter);
                } else if (clip.type === 'image') {
                    // Aplica um filtro zoompan neutro para imagens para garantir compatibilidade de pixel format e buffer
                    const staticMove = presetGenerator.getMovementFilter(null, duration, true, {}, targetRes, targetFps);
                    addFilter(staticMove);
                }

                // 5. ESCALA FINAL (Garantia pós-movimento)
                // Alguns filtros de movimento podem alterar SAR/Dimensões
                addFilter(`scale=${targetRes.w}:${targetRes.h},setsar=1`);

                mainTrackLabels.push({
                    label: currentV,
                    duration: duration,
                    transition: clip.transition // Transição de ENTRADA deste clipe (na UI visualmente é entre o anterior e este)
                });

                // --- PROCESSAMENTO DE ÁUDIO DO CLIPE DE VÍDEO ---
                const mediaInfo = mediaLibrary[clip.fileName];
                const audioLabel = `a_base_${i}`;
                
                // Formato seguro para mixagem
                const audioFormatFilter = 'aformat=sample_rates=44100:channel_layouts=stereo:sample_fmts=fltp';

                if (clip.type === 'video' && mediaInfo?.hasAudio) {
                    const start = clip.mediaStartOffset || 0;
                    // Volume
                    const vol = clip.properties.volume !== undefined ? clip.properties.volume : 1;
                    filterChain += `[${idx}:a]${audioFormatFilter},atrim=start=${start}:duration=${start + duration},asetpts=PTS-STARTPTS,volume=${vol}[${audioLabel}];`;
                    baseAudioSegments.push(`[${audioLabel}]`);
                } else {
                    // Gera silêncio se não tiver áudio, para manter a sincronia na concatenação
                    // É mais seguro usar uma fonte anullsrc nova para cada clipe para evitar problemas de timestamp
                    const silenceIdx = inputIndexCounter++;
                    inputs.push('-f', 'lavfi', '-t', duration.toString(), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
                    filterChain += `[${silenceIdx}:a]${audioFormatFilter}[${audioLabel}];`;
                    baseAudioSegments.push(`[${audioLabel}]`);
                }
            });
        }

        // --- 2. COMPOSIÇÃO DA TRILHA PRINCIPAL (XFADE & ACROSSFADE) ---
        let mainVideoStream = '[black_bg]';
        let mainAudioStream = '[base_audio_seq]';
        
        if (mainTrackLabels.length > 0 && typeof mainTrackLabels[0] === 'string') {
             // Caso dummy
             mainVideoStream = mainTrackLabels[0];
             mainAudioStream = baseAudioSegments[0];
        } else if (mainTrackLabels.length > 0) {
            let currentMixV = mainTrackLabels[0].label;
            let currentMixA = baseAudioSegments[0];
            let accumulatedDuration = mainTrackLabels[0].duration;

            for (let i = 1; i < mainTrackLabels.length; i++) {
                const nextClip = mainTrackLabels[i];
                const prevClip = mainTrackLabels[i-1]; // Note: duration here is theoretical original duration
                
                // Pega a transição definida no clipe atual (que representa a transição entre Anterior -> Este)
                const trans = nextClip.transition || { id: 'fade', duration: 0.5 };
                const hasExplicitTrans = !!nextClip.transition;
                
                // Duração da transição não pode exceder metade da duração dos clipes adjacentes
                // E não pode ser maior que a duração acumulada atual (offset)
                let transDur = hasExplicitTrans ? trans.duration : 0;
                
                // Safe clamps
                // Precisamos saber a duração "restante" do clipe anterior no fluxo... 
                // Xfade usa offset. O offset é onde a transição COMEÇA.
                // O clipe A termina visualmente em Offset + TransDur.
                
                // Ajuste para cortes secos (Hard Cuts)
                if (!hasExplicitTrans) {
                     // Simulamos um corte seco usando concat simples?
                     // Para simplicidade e consistência de código, usamos um xfade ultra-rápido (0.04s ~ 1 frame)
                     transDur = 0.04;
                }

                // Calcular Offset
                // Offset = (Duração Acumulada do Mix Atual) - Duração da Transição
                const offset = accumulatedDuration - transDur;
                
                if (offset < 0) {
                    console.warn(`Transição ${i} impossível: offset negativo. Clip muito curto.`);
                    transDur = 0.04; // fallback to hard cut logic
                }

                const transId = presetGenerator.getTransitionXfade(trans.id);
                
                // Labels para o resultado desta iteração
                const nextLabelV = `mix_v_${i}`;
                const nextLabelA = `mix_a_${i}`;
                
                // Montar Filtro XFADE
                filterChain += `${currentMixV}${nextClip.label}xfade=transition=${transId}:duration=${transDur}:offset=${offset}[${nextLabelV}];`;
                
                // Montar Filtro ACROSSFADE
                // Acrossfade não usa offset absoluto, ele consome o final do stream A e inicio do B.
                // Mas como estamos construindo iterativamente, stream A é o resultado acumulado.
                filterChain += `${currentMixA}${baseAudioSegments[i]}acrossfade=d=${transDur}:c1=tri:c2=tri[${nextLabelA}];`;
                
                // Atualizar ponteiros
                currentMixV = `[${nextLabelV}]`;
                currentMixA = `[${nextLabelA}]`;
                
                // Atualizar duração acumulada
                // Nova Duração = Offset + Duração do Clipe B
                accumulatedDuration = offset + nextClip.duration;
            }
            mainVideoStream = currentMixV;
            mainAudioStream = currentMixA;
        } 
        
        // --- FILTROS PÓS-TRANSIÇÃO GLOBAIS ---
        // (Ex: Se quiséssemos aplicar um look global)
        if (globalPostFilters.length > 0) {
            const postFxLabel = `v_post_fx`;
            const combinedFilters = globalPostFilters.join(',');
            filterChain += `${mainVideoStream}${combinedFilters}[${postFxLabel}];`;
            mainVideoStream = `[${postFxLabel}]`;
        }

        // --- 3. APLICAR OVERLAYS (Texto, Imagens, Legendas) ---
        let finalComp = mainVideoStream;
        
        overlayClips.forEach((clip, i) => {
            let overlayInputLabel = '';
            
            if (clip.type === 'text') {
                 // GERADOR DE TEXTO (DRAWTEXT)
                 // Criamos um fundo transparente do tamanho do vídeo para desenhar o texto
                 const bgLabel = `txtbg_${i}`;
                 filterChain += `color=c=black@0.0:s=${targetRes.w}x${targetRes.h}:r=${targetFps}:d=${clip.duration}[${bgLabel}];`;

                 let txt = (clip.properties.text || '');
                 const maxChars = targetRes.w > 1280 ? 50 : 30; // Mais caracteres em 4k
                 txt = wrapText(txt, maxChars);
                 const escapedTxt = escapeDrawText(txt);
                 
                 let color = clip.properties.textDesign?.color || 'white';
                 if (color === 'transparent') color = 'white@0.0';

                 // Tamanho da fonte relativo à resolução (Base 80px para 720p)
                 const baseFontSize = 80;
                 const scaleFactor = targetRes.w / 1280;
                 const fontsize = Math.round(baseFontSize * scaleFactor * (clip.properties.transform?.scale || 1));
                 
                 // Posição
                 let x = '(w-text_w)/2';
                 let y = '(h-text_h)/2';
                 
                 if (clip.properties.transform) {
                     const t = clip.properties.transform;
                     // Ajuste fino de posição relativo
                     if (t.x) x += `+(${t.x}*${scaleFactor})`;
                     if (t.y) y += `+(${t.y}*${scaleFactor})`;
                 }
                 
                 let styles = '';
                 // Stroke
                 if (clip.properties.textDesign?.stroke) {
                     const s = clip.properties.textDesign.stroke;
                     if (s.width > 0) {
                        styles += `:borderw=${s.width * scaleFactor}:bordercolor=${s.color || 'black'}`;
                     }
                 }
                 // Shadow
                 if (clip.properties.textDesign?.shadow) {
                     const sh = clip.properties.textDesign.shadow;
                     if (sh.x || sh.y) {
                         styles += `:shadowx=${(sh.x || 2) * scaleFactor}:shadowy=${(sh.y || 2) * scaleFactor}:shadowcolor=${sh.color || 'black@0.5'}`;
                     }
                 }
                 
                 // Font file (Tenta usar fonte padrão do sistema ou uma fonte segura se a customizada não existir no servidor)
                 // No ambiente server-side real, você deve mapear nomes de fontes para caminhos de arquivos .ttf
                 const fontFile = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"; // Caminho comum Linux
                 const fontArg = `:fontfile='${fontFile}'`;

                 const txtLabel = `txt_${i}`;
                 filterChain += `[${bgLabel}]drawtext=text='${escapedTxt}'${fontArg}:fontcolor=${color}:fontsize=${fontsize}:x=${x}:y=${y}${styles}[${txtLabel}];`;
                 overlayInputLabel = `[${txtLabel}]`;

            } else {
                 // IMAGEM SOBREPOSTA (PIP)
                 const filePath = fileMap[clip.fileName];
                 if (!filePath) return;
                 
                 inputs.push('-loop', '1', '-t', clip.duration.toString(), '-i', filePath);
                 const idx = inputIndexCounter++;
                 const imgLabel = `img_ov_${i}`;
                 
                 // Escala da imagem PIP
                 const scale = clip.properties.transform?.scale || 0.5;
                 const w = Math.floor(targetRes.w * scale / 2) * 2; // Força par
                 
                 // Aplicar rotação se necessário (rotate filter)
                 let transformFilters = `scale=${w}:-1`;
                 if (clip.properties.transform?.rotation) {
                     // Note: rotate preenche com preto por padrão, idealmente usaríamos fundo transparente c=none se disponível
                     transformFilters += `,rotate=${clip.properties.transform.rotation}*PI/180:c=none:ow=rotw(iw):oh=roth(ih)`;
                 }
                 
                 filterChain += `[${idx}:v]${transformFilters}[${imgLabel}];`;
                 overlayInputLabel = `[${imgLabel}]`;
            }

            // Aplicar Overlay com Timing (enable='between(...)')
            const nextCompLabel = `comp_${i}`;
            const startTime = clip.start;
            const endTime = startTime + clip.duration;
            
            // Calculo de posição do overlay
            let overlayX = '(W-w)/2';
            let overlayY = '(H-h)/2';
            if (clip.type !== 'text' && clip.properties.transform) {
                 const t = clip.properties.transform;
                 const scaleFactor = targetRes.w / 1280;
                 if (t.x) overlayX += `+(${t.x}*${scaleFactor})`;
                 if (t.y) overlayY += `+(${t.y}*${scaleFactor})`;
            }

            // Precisamos ajustar o PTS do overlay para começar do 0 relativo ao vídeo principal, mas ser exibido no tempo certo
            // A abordagem 'enable' mostra o frame atual do overlay no tempo T do main.
            // Para imagens estáticas/texto (geradas com duração X), elas começam em PTS 0.
            // Se usarmos enable between T1 e T2, o overlay stream deve estar sincronizado ou ser estático.
            // Como geramos os overlays com duração exata do clipe, precisamos atrasar o inicio deles (PTS offset)
            // OU usar 'eof_action=pass' se for stream infinito.
            
            const shiftedLabel = `shift_${i}`;
            filterChain += `${overlayInputLabel}setpts=PTS+${startTime}/TB[${shiftedLabel}];`;
            
            filterChain += `${finalComp}[${shiftedLabel}]overlay=x=${overlayX}:y=${overlayY}:enable='between(t,${startTime},${endTime})':eof_action=pass[${nextCompLabel}];`;
            finalComp = `[${nextCompLabel}]`;
        });

        // --- 4. MIXAGEM DE ÁUDIO (Trilhas Extras) ---
        let audioMixInputs = [mainAudioStream];
        const safeAudioFormat = 'aformat=sample_rates=44100:channel_layouts=stereo:sample_fmts=fltp';
        
        audioClips.forEach((clip, i) => {
            const filePath = fileMap[clip.fileName];
            if (!filePath) return;
            
            inputs.push('-i', filePath);
            const idx = inputIndexCounter++;
            const lbl = `sfx_${i}`;
            
            const startTrim = clip.mediaStartOffset || 0;
            const volume = clip.properties.volume !== undefined ? clip.properties.volume : 1;
            const delayMs = Math.round(clip.start * 1000); 
            
            // Processamento: Trim -> Format -> Volume -> Delay
            filterChain += `[${idx}:a]atrim=start=${startTrim}:duration=${startTrim + clip.duration},asetpts=PTS-STARTPTS,${safeAudioFormat},volume=${volume},adelay=${delayMs}|${delayMs}[${lbl}];`;
            audioMixInputs.push(`[${lbl}]`);
        });

        let finalAudio = '[final_audio_out]';
        if (audioMixInputs.length > 1) {
            // amix mistura todas as entradas. 
            // dropout_transition=0 evita fades estranhos. 
            // normalize=0 evita que o volume flutue dependendo do número de inputs ativos.
            // weights pode ser usado se quisermos priorizar o mainAudio, mas volume filter já cuida disso.
            filterChain += `${audioMixInputs.join('')}amix=inputs=${audioMixInputs.length}:duration=first:dropout_transition=0:normalize=0[final_audio_out];`;
        } else {
            finalAudio = mainAudioStream;
        }

        // Limpeza final da string (remover ; extra se houver)
        if (filterChain.endsWith(';')) {
            filterChain = filterChain.slice(0, -1);
        }

        return {
            inputs,
            filterComplex: filterChain,
            outputMapVideo: finalComp,
            outputMapAudio: finalAudio
        };
    }
};
