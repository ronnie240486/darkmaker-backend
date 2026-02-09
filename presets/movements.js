
export function getMovementFilter(moveId, durationSec = 5, targetW = 1280, targetH = 720) {
    const d = parseFloat(durationSec) || 5;
    const w = parseInt(targetW) || 1280;
    const h = parseInt(targetH) || 720;
    const fps = 24; 
    
    // Normalize time
    const zNorm = `(time/${d})`; 
    const rNorm = `(t/${d})`;
    const onNorm = `(on/(${d}*${fps}))`; // Use output frame number logic if needed, but keeping consistent with server logic for now

    const zp = `zoompan=d=1:fps=${fps}:s=${w}x${h}`;
    const center = `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    
    const moves = {
        'static': `${zp}:z=1.0${center}`,
        'kenburns': `${zp}:z='1.0+(0.3*${zNorm})':x='(iw/2-(iw/zoom/2))*(1-0.2*${zNorm})':y='(ih/2-(ih/zoom/2))*(1-0.2*${zNorm})'`,
        'mov-3d-float': `${zp}:z='1.1+0.05*sin(time*2)':x='iw/2-(iw/zoom/2)+iw*0.03*sin(time)':y='ih/2-(ih/zoom/2)+ih*0.03*cos(time)'`,
        'mov-tilt-up-slow': `${zp}:z=1.2:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))+(ih/4*${zNorm})'`,
        'mov-tilt-down-slow': `${zp}:z=1.2:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))-(ih/4*${zNorm})'`,

        'zoom-in': `${zp}:z='1.0+(0.5*${zNorm})'${center}`,
        'zoom-out': `${zp}:z='1.5-(0.5*${zNorm})'${center}`,
        'mov-zoom-crash-in': `${zp}:z='1.0+3*${zNorm}*${zNorm}*${zNorm}'${center}`,
        'mov-zoom-crash-out': `${zp}:z='4-3*${zNorm}'${center}`,
        'mov-zoom-bounce-in': `${zp}:z='if(lt(${zNorm},0.8), 1.0+0.5*${zNorm}, 1.5-0.1*sin((${zNorm}-0.8)*20))'${center}`,
        'mov-zoom-pulse-slow': `${zp}:z='1.1+0.1*sin(time*2)'${center}`,
        'mov-dolly-vertigo': `${zp}:z='1.0+(1.0*${zNorm})'${center}`,
        
        'mov-zoom-twist-in': `rotate=angle='(PI/12)*${rNorm}':fillcolor=black,${zp}:z='1.0+(0.5*${zNorm})'${center}`,
        'mov-zoom-wobble': `${zp}:z='1.1':x='iw/2-(iw/zoom/2)+20*sin(time*2)':y='ih/2-(ih/zoom/2)+20*cos(time*2)'`,
        'mov-scale-pulse': `${zp}:z='1.0+0.2*sin(time*3)'${center}`,

        'mov-pan-slow-l': `${zp}:z=1.4:x='(iw/2-(iw/zoom/2))*(1+0.5*${zNorm})'${center}`,
        'mov-pan-slow-r': `${zp}:z=1.4:x='(iw/2-(iw/zoom/2))*(1-0.5*${zNorm})'${center}`,
        'mov-pan-slow-u': `${zp}:z=1.4:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))*(1+0.5*${zNorm})'`,
        'mov-pan-slow-d': `${zp}:z=1.4:x='iw/2-(iw/zoom/2)':y='(ih/2-(ih/zoom/2))*(1-0.5*${zNorm})'`,
        'mov-pan-fast-l': `${zp}:z=1.4:x='(iw/2-(iw/zoom/2))*(1+1.0*${zNorm})'${center}`,
        'mov-pan-fast-r': `${zp}:z=1.4:x='(iw/2-(iw/zoom/2))*(1-1.0*${zNorm})'${center}`,
        'mov-pan-diag-tl': `${zp}:z=1.4:x='(iw/2-(iw/zoom/2))*(1+0.5*${zNorm})':y='(ih/2-(ih/zoom/2))*(1+0.5*${zNorm})'`,
        'mov-pan-diag-br': `${zp}:z=1.4:x='(iw/2-(iw/zoom/2))*(1-0.5*${zNorm})':y='(ih/2-(ih/zoom/2))*(1-0.5*${zNorm})'`,

        'handheld-1': `${zp}:z=1.1:x='iw/2-(iw/zoom/2)+10*sin(time*2)':y='ih/2-(ih/zoom/2)+10*cos(time*3)'`,
        'handheld-2': `${zp}:z=1.1:x='iw/2-(iw/zoom/2)+20*sin(time)':y='ih/2-(ih/zoom/2)+20*cos(time*1.5)'`,
        'earthquake': `${zp}:z=1.1:x='iw/2-(iw/zoom/2)+40*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+40*(random(1)-0.5)'`,
        'mov-jitter-x': `${zp}:z=1.05:x='iw/2-(iw/zoom/2)+10*sin(time*20)'${center}`,
        'mov-walk': `${zp}:z=1.1:x='iw/2-(iw/zoom/2)+15*sin(time*3)':y='ih/2-(ih/zoom/2)+10*abs(sin(time*1.5))'`,

        'mov-3d-spin-axis': `rotate=angle='2*PI*${rNorm}':fillcolor=black,${zp}:z=1.2${center}`,
        'mov-3d-flip-x': `${zp}:z='1.0+0.4*abs(sin(time*3))':x='iw/2-(iw/zoom/2)+(iw/4)*sin(time*5)'${center}`, 
        'mov-3d-flip-y': `${zp}:z='1.0+0.4*abs(cos(time*3))':y='ih/2-(iw/zoom/2)+(ih/4)*cos(time*5)'${center}`,
        'mov-3d-swing-l': `rotate=angle='(PI/8)*sin(time)':fillcolor=black,${zp}:z=1.2${center}`,
        'mov-3d-roll': `rotate=angle='2*PI*${rNorm}':fillcolor=black,${zp}:z=1.5${center}`,

        'mov-glitch-snap': `${zp}:z='if(lt(mod(time,1.0),0.1), 1.3, 1.0)':x='iw/2-(iw/zoom/2)+if(lt(mod(time,1.0),0.1), iw*0.1, 0)'${center},noise=alls=20:allf=t`,
        'mov-glitch-skid': `${zp}:z=1.0:x='iw/2-(iw/zoom/2)+if(lt(mod(time,0.5),0.1), iw*0.2, 0)'${center}`,
        'mov-shake-violent': `${zp}:z=1.2:x='iw/2-(iw/zoom/2)+60*(random(1)-0.5)':y='ih/2-(ih/zoom/2)+60*(random(1)-0.5)'`,
        'mov-rgb-shift-move': `rgbashift=rh=20:bv=20,${zp}:z=1.05${center}`,
        'mov-vibrate': `${zp}:z=1.02:x='iw/2-(iw/zoom/2)+5*sin(time*50)':y='ih/2-(ih/zoom/2)+5*cos(time*50)'`,

        // Fix comma escaping for client-side preview if needed, keeping simple quotes
        'mov-blur-in': `gblur=sigma='20*max(0,1-${rNorm})':steps=2,${zp}:z=1${center}`,
        'mov-blur-out': `gblur=sigma='min(20,20*${rNorm})':steps=2,${zp}:z=1${center}`,
        
        'mov-blur-pulse': `gblur=sigma='10*abs(sin(t*2))':steps=1,${zp}:z=1${center}`,
        
        'mov-tilt-shift': `eq=saturation=1.4:contrast=1.1,${zp}:z=1.1${center}`,

        'mov-rubber-band': `${zp}:z='1.0+0.3*abs(sin(time*2))'${center}`,
        'mov-jelly-wobble': `${zp}:z='1.0+0.1*sin(time)':x='iw/2-(iw/zoom/2)+10*sin(time*4)':y='ih/2-(ih/zoom/2)+10*cos(time*4)'`,
        'mov-pop-up': `${zp}:z='min(1.0 + ${zNorm}*5, 1.0)'${center}`,
        'mov-bounce-drop': `${zp}:z='1.0':y='(ih/2-(ih/zoom/2)) + (ih/2 * abs(cos(${zNorm}*5*PI)) * (1-${zNorm}))'`
    };

    const selectedFilter = moves[moveId] || moves['kenburns'];
    const scaleFactor = 2.0;
    
    // We use a larger initial scale to allow for zooming without pixelation before downscaling to target
    const pre = `scale=${Math.ceil(w*scaleFactor)}:${Math.ceil(h*scaleFactor)}:force_original_aspect_ratio=increase,crop=${Math.ceil(w*scaleFactor)}:${Math.ceil(h*scaleFactor)},setsar=1`;
    const post = `scale=${w}:${h}:flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=${fps},format=yuv420p`;
    
    return `${pre},${selectedFilter},${post}`;
}
