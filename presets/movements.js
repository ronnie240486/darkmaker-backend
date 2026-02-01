// movements.js – FFmpeg Ken Burns + Realístico
export function getMovementFilter(id, durationSec = 5) {
    const fps = 30;
    const frames = durationSec * fps;

    const base = `zoompan=d=${frames}:s=1280x720:fps=30`;
    const cx = `(iw/2)-(iw/zoom/2)`;
    const cy = `(ih/2)-(ih/zoom/2)`;

    const map = {
        // Suave
        "static": null,
        "kenburns": `${base}:z='1+0.15*(on/${frames})':x='${cx}':y='${cy}'`,
        "float": `${base}:z='1.05':x='${cx}+sin(on*0.05)*10':y='${cy}+cos(on*0.05)*10'`,

        // Zoom
        "zoom-in": `${base}:z='1+0.3*(on/${frames})':x='${cx}':y='${cy}'`,
        "zoom-out": `${base}:z='1.3-0.3*(on/${frames})':x='${cx}':y='${cy}'`,
        "zoom-bounce": `${base}:z='1+0.4*sin(on*0.15)'`,

        // Pan
        "pan-left": `${base}:z=1:x='${cx}-on*2':y='${cy}'`,
        "pan-right": `${base}:z=1:x='${cx}+on*2':y='${cy}'`,
        "pan-up": `${base}:z=1:x='${cx}':y='${cy}-on*2'`,
        "pan-down": `${base}:z=1:x='${cx}':y='${cy}+on*2'`,

        // Handheld (realista)
        "handheld": `${base}:z='1.02':x='${cx}+sin(on*0.3)*3':y='${cy}+cos(on*0.25)*3'`,
        "jitter": `${base}:z='1.0':x='${cx}+sin(on*2)*8':y='${cy}+cos(on*3)*8'`,

        // Rotação / 3D fake
        "roll": "rotate=0.03*sin(t*2)",

        // Shake forte
        "shake": `crop=w=iw*0.95:h=ih*0.95:x='(iw-ow)/2+((random(1)-0.5)*20)':y='(ih-oh)/2+((random(2)-0.5)*20)',scale=1280:720`,
    };

    return map[id] || null;
}
