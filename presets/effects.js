// effects.js – FFmpeg safe
export function getEffectFilter(id) {
    const map = {
        // Cor e estilo
        "mono": "hue=s=0",
        "noir": "hue=s=0,contrast=1.3",
        "sepia": "colorchannelmixer=.393:.769:.189:.349:.686:.168:.272:.534:.131",
        "cinema": "eq=contrast=1.2:saturation=1.2",

        // Glow / Luz
        "glow": "gblur=sigma=10",
        "flash": "tblend=all_mode=lighten,fade=t=in:st=0:d=0.2",

        // Glitch
        "glitch": "geq=random(1)",
        "rgb-shift": "chromashift=rh=4:bh=-4",
        "scanlines": "lutrgb=r='r(X,Y)*0.8':g='g(X,Y)*0.8':b='b(X,Y)*0.8',format=yuv420p",

        // Pixel / arte
        "pixel": "scale=iw/20:ih/20,scale=iw*20:ih*20:flags=neighbor",
        "oil": "oilink=radius=3",
        "sketch": "edgedetect=mode=colormix",

        // Blur
        "blur": "gblur=sigma=5",
        "tilt-shift": "boxblur=2:1:cr=0.5:ar=1",

        // Noise
        "noise": "noise=alls=20",
    };

    return map[id] || null;
}
