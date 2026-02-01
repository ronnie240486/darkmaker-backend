/**
 * MOVEMENTS ENGINE – COMPATÍVEL COM FFMPEG 6+
 * Todos os movimentos listados pelo usuário, convertidos para filtros válidos.
 */

const fpsDefault = 30;

/* -------------------------
   ANIMAÇÃO SUAVE (EASING)
--------------------------- */
function easingExpr(duration, fps) {
    const frames = Math.max(1, Math.ceil(duration * fps));
    const t = `(on/${frames})`;
    return `(1-(1-${t})*(1-${t}))`; // ease-out
}

/* -------------------------
   BASE ZOOMPAN
--------------------------- */
function zoompanBase(w, h, fps) {
    return `zoompan=s=${w}x${h}:fps=${fps}`;
}

/* -------------------------
   TABELA DE MOVIMENTOS
--------------------------- */
function buildMovementFilter(id, duration = 3, fps = fpsDefault, w = 1280, h = 720) {
    const ease = easingExpr(duration, fps);
    const base = zoompanBase(w, h, fps);

    const map = {
        /* -------------------------
            ESTÁTICOS
        --------------------------- */
        "static":       `${base}:z=1`,
        "static-smooth":`${base}:z='1+(0.02*${ease})'`,

        /* -------------------------
            ZOOMS
        --------------------------- */
        "kenburns":     `${base}:z='1+(0.25*${ease})'`,
        "zoom-in":      `${base}:z='1+(0.40*${ease})'`,
        "zoom-out":     `${base}:z='1.4-(0.40*${ease})'`,
        "zoom-crash":   `${base}:z='1+(1.2*${ease})'`,
        "zoom-crash-out":`${base}:z='1.6-(0.8*${ease})'`,
        "zoom-bounce":  `${base}:z='1+(0.6*${ease})':x='(iw-ow)/2':y='(ih-oh)/2'`,
        "zoom-pulse":   `${base}:z='1+0.03*sin(2*PI*${ease}*4)'`,

        "vertigo":      `perspective=fov='15+(25*${ease})':pitch=0:yaw=0:roll=0`,

        /* Twist = giro leve + zoom */
        "zoom-twist":   `${base}:z='1+(0.35*${ease})',rotate='0.02*${ease}'`,

        "zoom-wobble":  `${base}:z='1+(0.25*${ease})',rotate='0.04*sin(5*${ease})'`,
        "scale-pulse":  `${base}:z='1+(0.05*sin(6*${ease}))'`,

        /* -------------------------
            PANS
        --------------------------- */
        "pan-left":     `${base}:x='iw*0.2*${ease}'`,
        "pan-right":    `${base}:x='iw*0.2*(1-${ease})'`,
        "tilt-up":      `${base}:y='ih*0.2*(1-${ease})'`,
        "tilt-down":    `${base}:y='ih*0.2*${ease}'`,

        "pan-fast-left":`${base}:x='iw*0.4*${ease}'`,
        "pan-fast-right":`${base}:x='iw*0.4*(1-${ease})'`,

        "diag-up-left": `${base}:x='iw*0.25*${ease}':y='ih*0.25*(1-${ease})'`,
        "diag-down-right": `${base}:x='iw*0.25*(1-${ease})':y='ih*0.25*${ease}'`,

        /* -------------------------
            HANDHELD / SHAKE
        --------------------------- */
        "handheld1": `crop=w=iw*0.98:h=ih*0.98:x='5*sin(3*${ease})':y='5*sin(2*${ease})',scale=${w}:${h}`,
        "handheld2": `crop=w=iw*0.97:h=ih*0.97:x='8*sin(5*${ease})':y='8*sin(4*${ease})',scale=${w}:${h}`,

        "shake":     `crop=w=iw*0.90:h=ih*0.90:x='(random(1)-0.5)*25':y='(random(2)-0.5)*25',scale=${w}:${h}`,
        "jitter":    `crop=w=iw*0.95:h=ih*0.95:x='(random(1)-0.5)*10':y='(random(2)-0.5)*10',scale=${w}:${h}`,
        "walk":      `crop=w=iw*0.93:h=ih*0.93:y='(sin(2*PI*${ease})*15)':x='(sin(PI*${ease})*8)',scale=${w}:${h}`,

        /* -------------------------
            3D / ROTAÇÃO
        --------------------------- */
        "3d-spin":    `rotate='2*PI*${ease}'`,
        "3d-flip-x":  `rotate='PI*${ease}':ow=${w}:oh=${h}`,
        "3d-flip-y":  `rotate='PI*${ease}':ow=${w}:oh=${h}:c=none`,
        "pendulum":   `rotate='0.15*sin(4*PI*${ease})'`,
        "roll":       `rotate='0.5*(2*${ease}-1)'`,

        /* -------------------------
            GLITCH / DIGITAL
        --------------------------- */
        "glitch-snap":  `shuffleframes=2|1|0`,
        "glitch-skid":  `crop=w=iw*0.98:h=ih*0.98:x='20*mod(${ease},0.2)':y='10*mod(${ease},0.1)',scale=${w}:${h}`,
        "shake-hard":   `crop=w=iw*0.85:h=ih*0.85:x='(random(1)-0.5)*40':y='(random(2)-0.5)*40',scale=${w}:${h}`,
        "rgb-shift":    `chromashift=cr='5*${ease}':cb='-5*${ease}'`,
        "sonic-vibe":   `vibrance=intensity=0.8:saturation=2`,

        /* -------------------------
            BLUR / FOCUS
        --------------------------- */
        "focus-in":     `boxblur='20*(1-${ease})'`,
        "focus-out":    `boxblur='20*${ease}'`,
        "blur-pulse":   `boxblur='8*(0.5+0.5*sin(4*PI*${ease}))'`,
        "tilt-shift":   `tiltshift=amount='0.6*${ease}':center=0.6`,

        /* -------------------------
            ELÁSTICOS
        --------------------------- */
        "elastic":      `${base}:z='1+(0.25*sin(6*${ease}))'`,
        "jelly":        `${base}:z='1+(0.10*sin(10*${ease}))'`,
        "pop-up":       `${base}:z='1+(0.8*sin(${ease}*PI))'`,
        "bounce-drop":  `${base}:y='(ih*0.4*(1-${ease})*abs(sin(${ease}*3)))'`
    };

    // retorno padrão
    return map[id] || `${base}:z=1`;
}

/* -------------------------
   EXPORT COMPATÍVEL COM SERVER.JS
--------------------------- */
export function getMovementFilter(id, duration, fps, w, h) {
    return buildMovementFilter(id, duration, fps, w, h);
}

export { buildMovementFilter };
