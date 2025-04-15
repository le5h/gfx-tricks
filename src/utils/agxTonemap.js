import * as BABYLON from '@babylonjs/core';

export const createAgXTonemap = (scene, config = {}, pipeline) => {
    const shaderName = "agx";
    
    if (!scene.activeCamera) {
        console.warn('No active camera found for AgX tonemapping');
        return;
    }

    // Core AgX parameters - all configurable through JSON
    const agxParams = {
        // Core curve parameters
        slope: config.slope ?? 1.0,          // Neutral slope (1.0 = linear response)
        toe: config.toe ?? 0.5,              // Middle toe value
        shoulder: config.shoulder ?? 0.5,     // Middle shoulder value
        linearStart: config.linearStart ?? 0.1,  // Start linear section early
        linearLength: config.linearLength ?? 0.6, // Longer linear section
        linearSlope: config.linearSlope ?? 1.0,   // Neutral linear slope
        
        // Exposure and dynamic range
        exposureBias: config.exposureBias ?? 0.0,  // No exposure bias
        whitePoint: config.whitePoint ?? 1.0,      // Neutral white point
        maxValueMultiplier: config.maxValueMultiplier ?? 1.0,  // No additional multiplier
        
        // Color adjustments
        contrast: config.contrast ?? 1.0,     // Neutral contrast
        saturation: config.saturation ?? 1.0, // Neutral saturation
        
        // Black point handling
        blackPoint: config.blackPoint ?? 0.0,     // True black
        blackTransitionStart: config.blackTransitionStart ?? 0.0,  // Start at black
        blackTransitionEnd: config.blackTransitionEnd ?? 0.02,     // Gentle transition
        
        // Shadow preservation
        shadowStart: config.shadowStart ?? 0.0,    // Start at black
        shadowEnd: config.shadowEnd ?? 0.3,        // Wider shadow range
        shadowContrastFactor: config.shadowContrastFactor ?? 1.0,  // No contrast adjustment
        shadowSaturationFactor: config.shadowSaturationFactor ?? 1.0  // No saturation adjustment
    };

    // Disable default tonemapping
    if (scene.environmentTexture) {
        scene.environmentTexture.gammaSpace = false;
    }

    // WebGL1 vertex shader
    BABYLON.Effect.ShadersStore[shaderName + "VertexShader"] = `
        precision highp float;
        attribute vec2 position;
        varying vec2 vUV;
        void main(void) {
            vUV = position * 0.5 + 0.5;
            gl_Position = vec4(position, 0.0, 1.0);
        }`;

    // WebGL1 fragment shader
    BABYLON.Effect.ShadersStore[shaderName + "PixelShader"] = `
        precision highp float;
        varying vec2 vUV;
        uniform sampler2D textureSampler;
        uniform float exposure;
        uniform float contrast;
        uniform float saturation;

        void main() {
            vec4 color = texture2D(textureSampler, vUV);
            color.rgb *= exp2(exposure);
            vec3 mid = vec3(0.18);
            color.rgb = mix(mid, color.rgb, contrast);
            gl_FragColor = color;
        }`;

    // Create post process
    const postProcess = new BABYLON.PostProcess(
        "AgX",
        shaderName,
        ["exposure", "contrast", "saturation"],
        ["textureSampler"],
        1.0,
        scene.activeCamera,
        BABYLON.Texture.BILINEAR_SAMPLINGMODE,
        scene.getEngine(),
        true
    );

    // Update shader parameters
    postProcess.onApply = (effect) => {
        effect.setFloat("exposure", pipeline.imageProcessing.exposure);
        effect.setFloat("contrast", agxParams.contrast);
        effect.setFloat("saturation", agxParams.saturation);
    };

    return postProcess;
};
