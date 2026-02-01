export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {

    const d = parseFloat(durationSec) || 5;
    const fps = 30; 
    const totalFrames = Math.ceil(d * fps);

    const pre = `scale=${targetW*4}:${targetH*4}:force_original_aspect_ratio=increase,crop=${targetW*4}:${targetH*4},setsar=1`;
    const zdur = `:d=${totalFrames*2}:s=${targetW}x${targetH}:fps=${fps}`;
    const p = `(on/${totalFrames})`; 

    const moves = {

        // ---------- SAFE STATIC ----------
        'static': `zoompan=z=1.0:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'kenburns': `zoompan=z='min(1.2, 1.0+0.0005*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-3d-float': `zoompan=z='1.2+0.05*sin(on/60)':x='iw/2-(iw/zoom/2)+20*sin(on/50)':y='ih/2-(ih/zoom/2)+20*cos(on/60)'${zdur}`,

        // ---------- TILTS ----------
        'mov-tilt-up-slow': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/8 * ${p})'${zdur}`,
        'mov-tilt-down-slow': `zoompan=z=1.5:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/8 * ${p})'${zdur}`,

        // ---------- SAFE ZOOMS ----------
        'zoom-in': `zoompan=z='min(2.5, 1.0+(1.5*${p}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'zoom-out': `zoompan=z='max(1.0, 2.5-(1.5*${p}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,

        'mov-zoom-crash-in': `zoompan=z='min(4, 1.0+0.15*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-zoom-crash-out': `zoompan=z='max(1, 4-0.15*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-dolly-vertigo': `zoompan=z='1.0+(0.8*${p})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${zdur}`,

        // ---------- PAN SAFE ----------
        'mov-pan-slow-l': `zoompan=z=2.0:x='(iw/2-(iw/zoom/2)) + (iw/6 * ${p})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-r': `zoompan=z=2.0:x='(iw/2-(iw/zoom/2)) - (iw/6 * ${p})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-slow-u': `zoompan=z=2.0:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) + (ih/6 * ${p})'${zdur}`,
        'mov-pan-slow-d': `zoompan=z=2.0:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2)) - (ih/6 * ${p})'${zdur}`,

        'mov-pan-fast-l': `zoompan=z=2.0:x='(iw/2-(iw/zoom/2)) + (iw/5 * ${p})':y='ih/2-(ih/zoom/2)'${zdur}`,
        'mov-pan-fast-r': `zoompan=z=2.0:x='(iw/2-(iw/zoom/2)) - (iw/5 * ${p})':y='ih/2-(ih/zoom/2)'${zdur}`,

        // ---------- BLUR MOVEMENTS ----------
        'mov-blur-in': `gblur=sigma=10:steps=1,zoompan=z='1.1-0.1*${p}'${zdur}`,
        'mov-blur-out': `gblur=sigma=10:steps=1,zoompan=z='1+0.1*${p}'${zdur}`,
        'mov-blur-pulse': `gblur=sigma=8:steps=1,zoompan=z='1.05+0.03*sin(2*PI*${p})'${zdur},vignette=a=PI/6`,

        // ---------- TILT-SHIFT ----------
        'mov-tilt-shift': `gblur=sigma=4:steps=1,vignette=a=PI/5,zoompan=z='1.05+0.05*${p}'${zdur}`
    };

    const selectedFilter = moves[moveId] || moves['kenburns'];

    const post = `scale=${targetW}:${targetH}:flags=lanczos,setsar=1,fps=${fps},format=yuv420p`;

    return `${pre},${selectedFilter},${post}`;
}
