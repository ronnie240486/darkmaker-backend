
export function getFFmpegFilterFromEffect(effectId) {
    if (!effectId) return null;

    const effects = {
        // Cinematic Pro
        'teal-orange': 'colorbalance=rs=0.2:bs=-0.2,eq=contrast=1.1:saturation=1.3',
        'matrix': 'colorbalance=gs=0.3:rs=-0.2:bs=-0.2,eq=contrast=1.2',
        'noir': 'hue=s=0,eq=contrast=1.5:brightness=-0.1',
        'vintage-warm': 'colorbalance=rs=0.2:bs=-0.2,eq=gamma=1.2:saturation=0.8',
        'cool-morning': 'colorbalance=bs=0.2:rs=-0.1,eq=brightness=0.05',
        'cyberpunk': 'eq=contrast=1.2:saturation=1.5,colorbalance=bs=0.2:gs=0.1',
        'dreamy-blur': 'boxblur=2:1,eq=brightness=0.1:saturation=1.2',
        'horror': 'hue=s=0,eq=contrast=1.5:brightness=-0.2,noise=alls=10:allf=t',
        'underwater': 'colorbalance=bs=0.4:gs=0.1:rs=-0.3,eq=contrast=0.9',
        'sunset': 'colorbalance=rs=0.3:gs=-0.1:bs=-0.2,eq=saturation=1.3',
        'posterize': 'eq=contrast=2.0:saturation=1.5',
        'fade': 'eq=contrast=0.8:brightness=0.1',
        'vibrant': 'eq=saturation=2.0',
        'muted': 'eq=saturation=0.5',
        'b-and-w-low': 'hue=s=0,eq=contrast=0.8',
        'golden-hour': 'colorbalance=rs=0.2:gs=0.1:bs=-0.2,eq=saturation=1.2',
        'cold-blue': 'colorbalance=bs=0.3:rs=-0.1',
        'night-vision': 'hue=s=0,eq=brightness=0.1,colorbalance=gs=0.5,noise=alls=20:allf=t',
        'scifi': 'colorbalance=bs=0.2:gs=0.1,eq=contrast=1.3',
        'pastel': 'eq=saturation=0.7:brightness=0.1:contrast=0.9',

        // Estilos Artísticos
        'pop-art': 'eq=saturation=3:contrast=1.5',
        'sketch-sim': 'hue=s=0,eq=contrast=5:brightness=0.3', 
        'invert': 'negate',
        'sepia-max': 'colorbalance=rs=0.4:gs=0.2:bs=-0.4',
        'high-contrast': 'eq=contrast=2.0',
        'low-light': 'eq=brightness=-0.3',
        'overexposed': 'eq=brightness=0.4',
        'radioactive': 'hue=h=90:s=2',
        'deep-fried': 'eq=saturation=3:contrast=2,unsharp=5:5:2.0',
        'ethereal': 'boxblur=3:1,eq=brightness=0.2',

        // Tendência & Filtros Básicos
        'dv-cam': 'eq=saturation=0.8,noise=alls=5:allf=t',
        'bling': 'eq=brightness=0.1',
        'soft-angel': 'boxblur=2:1,eq=brightness=0.1',
        'sharpen': 'unsharp=5:5:1.5:5:5:0.0',
        'warm': 'colorbalance=rs=0.1:bs=-0.1',
        'cool': 'colorbalance=bs=0.1:rs=-0.1',
        'vivid': 'eq=saturation=1.5',
        'mono': 'hue=s=0',
        'bw': 'hue=s=0',
        'vintage': 'colorbalance=rs=0.2:gs=0.1:bs=-0.2,eq=contrast=0.9',
        'dreamy': 'boxblur=2:1',
        'sepia': 'colorbalance=rs=0.3:gs=0.2:bs=-0.2',

        // Glitch & Retro
        'glitch-pro-1': 'colorbalance=gs=0.1,noise=alls=10:allf=t',
        'glitch-pro-2': 'scale=iw/10:ih/10,scale=iw*10:ih*10:flags=neighbor',
        'vhs-distort': 'eq=saturation=1.5,boxblur=1:1,noise=alls=10:allf=t',
        'bad-signal': 'noise=alls=30:allf=t',
        'chromatic': 'colorbalance=rs=0.1:bs=0.1',
        'pixelate': 'scale=iw/20:ih/20,scale=iw*20:ih*20:flags=neighbor',
        'old-film': 'eq=saturation=0.5,noise=alls=15:allf=t',
        'dust': 'noise=alls=5:allf=t',
        'grain': 'noise=alls=15:allf=t',
        'vignette': 'eq=brightness=-0.1',
        'super8': 'eq=saturation=0.8:contrast=1.1,colorbalance=rs=0.1',
        'noise': 'noise=alls=20:allf=t'
    };

    if (effects[effectId]) return effects[effectId];

    // Efeitos Procedurais
    if (effectId.startsWith('cg-pro-')) {
        const i = parseInt(effectId.split('-')[2]) || 1;
        const c = 1 + (i % 5) * 0.1;
        const s = 1 + (i % 3) * 0.2;
        const h = (i * 15) % 360;
        return `eq=contrast=${c.toFixed(2)}:saturation=${s.toFixed(2)},hue=h=${h}`;
    }
    if (effectId.startsWith('vintage-style-')) {
        const i = parseInt(effectId.split('-')[2]) || 1;
        const sepia = 0.1 + (i % 5) * 0.05;
        return `colorbalance=rs=${sepia.toFixed(2)}:bs=-${sepia.toFixed(2)},eq=contrast=0.9`;
    }
    if (effectId.startsWith('cyber-neon-')) {
         const i = parseInt(effectId.split('-')[2]) || 1;
         return `eq=contrast=1.2:saturation=1.5,hue=h=${i*10}`;
    }
    if (effectId.startsWith('nature-fresh-')) {
         const i = parseInt(effectId.split('-')[2]) || 1;
         return `eq=saturation=1.3:brightness=0.05,hue=h=-${i*2}`;
    }
    if (effectId.startsWith('art-duo-')) {
         const i = parseInt(effectId.split('-')[2]) || 1;
         return `hue=s=0,colorbalance=rs=${0.1 * (i%3)}:bs=${0.1 * (i%2)}`;
    }
    if (effectId.startsWith('noir-style-')) {
         const i = parseInt(effectId.split('-')[2]) || 1;
         return `hue=s=0,eq=contrast=${(1 + i*0.05).toFixed(2)}`;
    }
    if (effectId.startsWith('film-stock-')) {
         const i = parseInt(effectId.split('-')[2]) || 1;
         return `eq=saturation=0.8:contrast=1.1`;
    }
    if (effectId.startsWith('leak-overlay-') || effectId.startsWith('light-leak-')) {
        return 'eq=brightness=0.1:gamma=1.1';
    }

    return null;
}
