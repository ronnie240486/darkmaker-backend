export function getTransitionXfade(transId, durationSec = 1, w = 1280, h = 720) {
    const d = parseFloat(durationSec) || 1;
    const fps = 30;
    
    // Normalização do tempo (0 → 1)
    const tnorm = `(t/${d})`;

    // ------------------------------------------------------------
    // PRESETS DE TRANSIÇÃO COM BLUR REAL (boxblur)
    // ------------------------------------------------------------
    const transitions = {
        
        // Fade normal
        "fade": `
            [0:v][1:v]xfade=transition=fade:duration=${d}:offset=0
        `,
        
        // Zoom + blur sutil
        "zoom-blur": `
            [0:v]zoompan=z='1.0 + 0.2*${tnorm}':d=1:s=${w}x${h},boxblur=lr='5*${tnorm}':lp=2[za];
            [1:v]zoompan=z='1.2 - 0.2*${tnorm}':d=1:s=${w}x${h},boxblur=lr='5*(1-${tnorm})':lp=2[zb];
            [za][zb]xfade=transition=fade:duration=${d}:offset=0
        `,

        // Desfocar total no meio da transição
        "blur-middle": `
            [0:v]boxblur=lr='20*${tnorm}':lp=2[a];
            [1:v]boxblur=lr='20*(1-${tnorm})':lp=2[b];
            [a][b]xfade=transition=fade:duration=${d}:offset=0
        `,

        // Blur radial estilo dream
        "dream": `
            [0:v]boxblur=lr='40*${tnorm}':lp=3[v0];
            [1:v]boxblur=lr='40*(1-${tnorm})':lp=3[v1];
            [v0][v1]xfade=transition=fade:duration=${d}:offset=0
        `,

        // Whip pan + blur forte (transição de ação)
        "whip-blur": `
            [0:v]boxblur=lr='25':lp=3,zoompan=z=1.0:x='iw*${tnorm}*2':y=0:d=1:s=${w}x${h}[a];
            [1:v]boxblur=lr='25':lp=3,zoompan=z=1.0:x='-iw*(1-${tnorm})*2':y=0:d=1:s=${w}x${h}[b];
            [a][b]xfade=transition=slideleft:duration=${d}:offset=0
        `,

        // Glitch + blur
        "glitch-blur": `
            [0:v]noise=alls=30:allf=t,boxblur=lr='10*${tnorm}':lp=2[a];
            [1:v]noise=alls=30:allf=t,boxblur=lr='10*(1-${tnorm})':lp=2[b];
            [a][b]xfade=transition=fade:duration=${d}:offset=0
        `,

        // Desfocar tudo no começo e ficar nítido no final
        "blur-in": `
            [0:v]boxblur=lr='30*(1-${tnorm})':lp=2[a];
            [1:v]boxblur=lr='30*${tnorm}':lp=2[b];
            [a][b]xfade=transition=fade:duration=${d}:offset=0
        `,

        // Zoom + deep blur dramático
        "cinematic-deep": `
            [0:v]zoompan=z='1.0 + 0.4*${tnorm}':d=1:s=${w}x${h},boxblur=lr='15*${tnorm}':lp=3[a];
            [1:v]zoompan=z='1.4 - 0.4*${tnorm}':d=1:s=${w}x${h},boxblur=lr='15*(1-${tnorm})':lp=3[b];
            [a][b]xfade=transition=fade:duration=${d}:offset=0
        `,
    };

    const selected = transitions[transId] || transitions["fade"];

    // Saída padronizada
    const post = `scale=${w}:${h}:flags=lanczos,fps=${fps},format=yuv420p`;

    return `
        ${selected},
        ${post}
    `;
}
