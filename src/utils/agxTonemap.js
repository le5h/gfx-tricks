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

    BABYLON.Effect.ShadersStore[shaderName + "VertexShader"] = `
        precision highp float;
        attribute vec2 position;
        uniform vec2 scale;
        varying vec2 vUV;
        const vec2 madd = vec2(0.5, 0.5);
        void main(void) {
            vUV = (position * madd + madd) * scale;
            gl_Position = vec4(position, 0.0, 1.0);
        }`;

    BABYLON.Effect.ShadersStore[shaderName + "PixelShader"] = `
        precision highp float;
        
        // Varyings
        varying vec2 vUV;
        
        // Uniforms
        uniform sampler2D textureSampler;
        uniform float exposure;
        uniform float contrast;
        uniform float saturation;
        uniform float whitePoint;
        uniform float maxValueMultiplier;

        // Constants from JSON config
        const float SLOPE = ${agxParams.slope.toFixed(6)};
        const float TOE = ${agxParams.toe.toFixed(6)};
        const float SHOULDER = ${agxParams.shoulder.toFixed(6)};
        const vec2 LINEAR_SECTION = vec2(${agxParams.linearStart.toFixed(6)}, ${agxParams.linearLength.toFixed(6)});
        const float LINEAR_SLOPE = ${agxParams.linearSlope.toFixed(6)};
        const float EXPOSURE_BIAS = ${agxParams.exposureBias.toFixed(6)};
        const float BLACK_POINT = ${agxParams.blackPoint.toFixed(6)};
        const float BLACK_TRANSITION_START = ${agxParams.blackTransitionStart.toFixed(6)};
        const float BLACK_TRANSITION_END = ${agxParams.blackTransitionEnd.toFixed(6)};
        const float SHADOW_START = ${agxParams.shadowStart.toFixed(6)};
        const float SHADOW_END = ${agxParams.shadowEnd.toFixed(6)};
        const float SHADOW_CONTRAST = ${agxParams.shadowContrastFactor.toFixed(6)};
        const float SHADOW_SATURATION = ${agxParams.shadowSaturationFactor.toFixed(6)};

        // Color space conversion
        vec3 sRGBToLinear(vec3 color) {
            return pow(max(color, vec3(0.0)), vec3(2.2));
        }

        vec3 linearToSRGB(vec3 color) {
            return pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
        }

        // Luminance calculation (Rec. 709)
        float getLuminance(vec3 color) {
            return dot(color, vec3(0.2126, 0.7152, 0.0722));
        }

        // Smooth curve helper
        float smoothCurve(float x) {
            return x * x * (3.0 - 2.0 * x);
        }

        // AgX tonemapping curve
        vec3 AgXToneMap(vec3 color) {
            vec3 result;
            for(int i = 0; i < 3; i++) {
                float x = max(0.0, color[i]);
                float y;
                
                if(x < LINEAR_SECTION[0]) {
                    float t = x / LINEAR_SECTION[0];
                    y = t * TOE;
                }
                else if(x < LINEAR_SECTION[0] + LINEAR_SECTION[1]) {
                    float t = (x - LINEAR_SECTION[0]) / LINEAR_SECTION[1];
                    y = mix(TOE, 1.0, t * LINEAR_SLOPE);
                }
                else {
                    float t = (x - (LINEAR_SECTION[0] + LINEAR_SECTION[1])) / (2.0 - (LINEAR_SECTION[0] + LINEAR_SECTION[1]));
                    t = clamp(t, 0.0, 1.0);
                    y = mix(TOE + LINEAR_SLOPE * LINEAR_SECTION[1],
                         1.0 + (maxValueMultiplier - 1.0) * SHOULDER,
                         smoothCurve(t));
                }
                
                result[i] = y;
            }
            return result;
        }

        // Main tonemapping function
        vec3 tonemap(vec3 color) {
            // Convert to linear space
            color = sRGBToLinear(color);
            
            // Calculate luminance and shadow mask with configurable transitions
            float lum = getLuminance(color);
            float shadowMask = 1.0 - smoothstep(SHADOW_START, SHADOW_END, lum);
            
            // Smooth black point transition using config values
            float blackLevel = smoothstep(BLACK_TRANSITION_START, BLACK_TRANSITION_END, lum);
            
            // Apply exposure with smooth black handling
            float exposureAdjust = exp2(exposure + EXPOSURE_BIAS);
            color *= exposureAdjust * mix(0.8, 1.0, blackLevel);
            
            // Apply AgX tonemapping
            vec3 tonemapped = AgXToneMap(color);
            
            // Apply white point with configurable shadow preservation
            float maxValue = max(max(tonemapped.r, tonemapped.g), tonemapped.b);
            if (maxValue > 0.0) {
                float wp = whitePoint * mix(SHADOW_CONTRAST, 1.0, smoothstep(0.0, 0.5, maxValue));
                tonemapped *= wp / maxValue;
            }
            
            // Apply contrast with configurable shadow preservation
            float adjustedContrast = contrast * mix(SHADOW_CONTRAST, 1.0, smoothstep(0.0, 0.2, getLuminance(tonemapped)));
            vec3 mean = vec3(0.18);
            tonemapped = mix(mean, tonemapped, adjustedContrast);
            
            // Apply saturation with configurable shadow preservation
            float adjustedSaturation = saturation * mix(SHADOW_SATURATION, 1.0, smoothstep(0.0, 0.08, getLuminance(tonemapped)));
            float luminance = getLuminance(tonemapped);
            tonemapped = mix(vec3(luminance), tonemapped, adjustedSaturation);
            
            // Final black point preservation with configurable transition
            vec3 result = linearToSRGB(max(tonemapped, 0.0));
            return mix(vec3(0.0), result, smoothstep(BLACK_TRANSITION_START, BLACK_TRANSITION_END, lum));
        }

        void main() {
            vec4 color = texture2D(textureSampler, vUV);
            gl_FragColor = vec4(tonemap(color.rgb), color.a);
        }`;

    const postProcess = new BABYLON.PostProcess(
        "AgX",
        shaderName,
        ["exposure", "contrast", "saturation", "whitePoint", "maxValueMultiplier"],
        ["textureSampler"],
        1.0,
        scene.activeCamera,
        BABYLON.Texture.BILINEAR_SAMPLINGMODE,
        scene.getEngine(),
        false,
        "#define WEBGL2"
    );

    // Update shader parameters
    postProcess.onApply = (effect) => {
        effect.setFloat("exposure", pipeline.imageProcessing.exposure);
        effect.setFloat("contrast", agxParams.contrast);
        effect.setFloat("saturation", agxParams.saturation);
        effect.setFloat("whitePoint", agxParams.whitePoint);
        effect.setFloat("maxValueMultiplier", agxParams.maxValueMultiplier);
    };

    return postProcess;
};
