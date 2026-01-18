
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
        
        // Basic Filters
        'sepia': 'colorbalance=rs=0.3:gs=0.2:bs=-0.2',
        'grayscale': 'hue=s=0',
        'vignette': 'eq=brightness=-0.1',
        
        // Glitch
        'glitch': 'colorbalance=gs=0.1,noise=alls=10:allf=t',
        'vhs': 'eq=saturation=1.5,boxblur=1:1,noise=alls=10:allf=t'
    };

    if (effects[effectId]) return effects[effectId];

    // Procedural fallbacks
    if (effectId.startsWith('leak')) {
        return 'eq=brightness=0.1:gamma=1.1';
    }

    return null;
}
