
export function getFFmpegFilterFromEffect(effectId) {
    if (!effectId) return null;

    const effects = {
        'teal-orange': 'colorbalance=rs=0.2:bs=-0.2,eq=contrast=1.1:saturation=1.3',
        'noir': 'hue=s=0,eq=contrast=1.5:brightness=-0.1',
        'vintage-warm': 'colorbalance=rs=0.2:bs=-0.2,eq=gamma=1.2:saturation=0.8',
        'cyberpunk': 'eq=contrast=1.2:saturation=1.5,colorbalance=bs=0.2:gs=0.1',
        // Removed boxblur to prevent compatibility issues
        'vhs-distort': 'eq=saturation=1.5,noise=alls=10:allf=t', 
        'old-film': 'eq=saturation=0.5,noise=alls=15:allf=t',
        'sepia': 'colorbalance=rs=0.3:gs=0.2:bs=-0.2',
        'matrix': 'colorbalance=gs=0.3:rs=-0.2:bs=-0.2,eq=contrast=1.2'
    };

    return effects[effectId] || null;
}
