// ---------------------------------------------------------
// MOVIMENTOS (ZOOM, PAN, ROTATE, 3D FAKE)
// ---------------------------------------------------------

export function buildMovementFilter(moveId, duration, fps, w, h) {
    switch (moveId) {

        // --------------------------
        // ZOOM SUAVE
        // --------------------------
        case "kenburns-in":
            return `zoompan=z='1+0.002*t':d=${duration * fps}:fps=${fps}`;

        case "kenburns-out":
            return `zoompan=z='1-0.002*t':d=${duration * fps}:fps=${fps}`;

        case "zoom-pulse":
            return `zoompan=z='1+0.1*sin(2*PI*t/2)':d=${duration * fps}:fps=${fps}`;


        // --------------------------
        // PAN (MOVIMENTO LATERAL)
        // --------------------------
        case "pan-left":
            return `zoompan=x='t*20':y=0:z=1:d=${duration * fps}:fps=${fps}`;

        case "pan-right":
            return `zoompan=x='-(t*20)':y=0:z=1:d=${duration * fps}:fps=${fps}`;

        case "pan-up":
            return `zoompan=y='t*20':x=0:z=1:d=${duration * fps}:fps=${fps}`;

        case "pan-down":
            return `zoompan=y='-(t*20)':x=0:z=1:d=${duration * fps}:fps=${fps}`;


        // --------------------------
        // ROTATE
        // --------------------------
        case "rotate":
            return "rotate=angle=PI/180*t*5";

        case "spin":
            return "rotate=angle=PI*t";


        // --------------------------
        // SHAKE / HANDHELD
        // --------------------------
        case "handheld":
            return "perspective=x0='10*sin(t*2)':y0='10*cos(t*2)'";

        case "shake":
            return "rotate=angle='0.02*sin(20*t)'";


        // --------------------------
        // DOLLY / WARP
        // --------------------------
        case "dolly":
            return `zoompan=z='1+0.005*t':d=${duration * fps}:fps=${fps}`;


        default:
            console.warn("⚠ Movimento não encontrado:", moveId);
            return "";
    }
}


// ---------------------------------------------------------
// LISTA DE MOVIMENTOS
// ---------------------------------------------------------

export const MOVEMENTS = [
    "kenburns-in",
    "kenburns-out",
    "zoom-pulse",

    "pan-left",
    "pan-right",
    "pan-up",
    "pan-down",

    "rotate",
    "spin",

    "handheld",
    "shake",

    "dolly"
];
