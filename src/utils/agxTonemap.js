import * as BABYLON from '@babylonjs/core';

export const createAgXTonemap = (scene, config = {}, pipeline) => {
    const shaderName = "agx";
    
    if (!scene.activeCamera) {
        console.warn('No active camera found for AgX tonemapping');
        return;
    }

    if (!scene.activeCamera.postProcesses) {
        scene.activeCamera.postProcesses = [];
    }

    // Simplified AgX parameters
    const agxParams = {
        slope: config.slope ?? 0.91,
        toe: config.toe ?? 0.53,
        shoulder: config.shoulder ?? 0.95,
        linearStart: config.linearStart ?? 0.1,
        linearLength: config.linearLength ?? 0.7,
        linearSlope: config.linearSlope ?? 0.91,
        exposureBias: config.exposureBias ?? 0.0,
        contrast: config.contrast ?? 1.0,
        saturation: config.saturation ?? 1.0,
        whitePoint: config.whitePoint ?? 2.0,
        maxValueMultiplier: config.maxValueMultiplier ?? 0.8,
        noiseScale: config.noiseScale ?? 0.15,
        noiseSpeed: config.noiseSpeed ?? 0.5,
        noiseEnabled: config.noiseEnabled ?? true
    };

    // Disable default tonemapping on the environment
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
        varying vec2 vUV;
        uniform sampler2D textureSampler;
        uniform float exposure;
        uniform float contrast;
        uniform float saturation;
        uniform float time;

        const float SLOPE = ${agxParams.slope.toFixed(6)};
        const float TOE = ${agxParams.toe.toFixed(6)};
        const float SHOULDER = ${agxParams.shoulder.toFixed(6)};
        const vec2 LINEAR_SECTION = vec2(${agxParams.linearStart.toFixed(6)}, ${agxParams.linearLength.toFixed(6)});
        const float LINEAR_SLOPE = ${agxParams.linearSlope.toFixed(6)};
        const float EXPOSURE_BIAS = ${agxParams.exposureBias.toFixed(6)};
        const float NOISE_SCALE = ${agxParams.noiseScale.toFixed(6)};
        const float NOISE_SPEED = ${agxParams.noiseSpeed.toFixed(6)};

        // White point adjustment
        const float WHITE_POINT = ${agxParams.whitePoint.toFixed(6)};

        // Simple noise function
        float noise(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        // Basic sRGB conversion
        vec3 sRGBToLinear(vec3 color) {
            return pow(color, vec3(2.2));
        }

        vec3 linearToSRGB(vec3 color) {
            return pow(color, vec3(1.0 / 2.2));
        }

        // Simple but accurate luminance calculation
        float getLuminance(vec3 color) {
            return dot(color, vec3(0.2126, 0.7152, 0.0722));
        }

        // Smooth shading helper
        float smoothCurve(float x) {
            return x * x * (3.0 - 2.0 * x);
        }

        vec3 AgXTonemap(vec3 color) {
            // Calculate brightness once
            float brightness = getLuminance(color);
            
            // Pre-calculate masks
            float darkMask = 1.0 - smoothstep(0.0, 0.3, brightness);
            float brightMask = smoothstep(0.7, 1.0, brightness);
            float midMask = 1.0 - darkMask - brightMask;
            
            // Apply noise if enabled
            if (${agxParams.noiseEnabled ? 'true' : 'false'}) {
                // Generate noise coordinates once
                vec2 noiseCoord = vUV * vec2(3840.0, 2160.0);
                float timeFactor = time * NOISE_SPEED;
                
                // Generate noise for each channel with pre-calculated time offsets
                vec3 channelNoise = vec3(
                    noise(noiseCoord + vec2(1.0, 0.0) + timeFactor),
                    noise(noiseCoord + vec2(0.0, 1.0) + timeFactor * 1.2),
                    noise(noiseCoord + vec2(1.0, 1.0) + timeFactor * 1.4)
                );
                
                // Normalize and scale noise
                channelNoise = (channelNoise * 2.0 - 1.0) * (NOISE_SCALE / 255.0);
                
                // Pre-calculate noise scales based on brightness
                float noiseScale = (mix(1.2, 0.0, smoothstep(0.0, 0.3, brightness)) +  // dark
                                  mix(0.0, 1.2, smoothstep(0.7, 1.0, brightness)) +     // bright
                                  mix(0.8, 0.8, smoothstep(0.3, 0.7, brightness))) / 3.0; // mid
                
                // Apply noise with pre-calculated masks
                color += channelNoise * noiseScale * (darkMask + midMask * 0.5);
                color -= channelNoise * noiseScale * (brightMask + midMask * 0.5);
            }
            
            // Apply exposure and white point
            color *= pow(2.0, EXPOSURE_BIAS) * exposure * WHITE_POINT;
            
            // Process each channel while preserving relationships
            vec3 agxColor;
            for(int i = 0; i < 3; i++) {
                float x = max(0.0, color[i]);
                
                if(x < LINEAR_SECTION[0]) {
                    float t = smoothCurve(x / LINEAR_SECTION[0]);
                    agxColor[i] = TOE * pow(t, SLOPE);
                }
                else if(x <= LINEAR_SECTION[1]) {
                    float t = smoothCurve((x - LINEAR_SECTION[0]) / (LINEAR_SECTION[1] - LINEAR_SECTION[0]));
                    float linearValue = LINEAR_SLOPE * (x - LINEAR_SECTION[0]) + TOE;
                    float toeValue = TOE * pow(1.0, SLOPE);
                    agxColor[i] = mix(toeValue, linearValue, t);
                }
                else {
                    float t = smoothCurve(clamp((x - LINEAR_SECTION[1]) / (4.0 - LINEAR_SECTION[1]), 0.0, 1.0));
                    float shoulderValue = 1.0 - pow(1.0 - t, 1.0 + SHOULDER * 0.5);
                    float maxValue = 1.0 + (t * ${agxParams.maxValueMultiplier.toFixed(6)});
                    
                    agxColor[i] = mix(
                        TOE + LINEAR_SLOPE * (LINEAR_SECTION[1] - LINEAR_SECTION[0]),
                        maxValue,
                        shoulderValue
                    );
                }
            }
            
            // Apply contrast while preserving relationships
            vec3 contrastedColor = pow(max(agxColor, vec3(0.0001)), vec3(contrast));
            float contrastLum = getLuminance(contrastedColor);
            float originalLum = getLuminance(agxColor);
            agxColor = contrastedColor * (originalLum / max(contrastLum, 0.0001));
            
            // Modified highlight desaturation to preserve bright whites
            float lum = getLuminance(agxColor);
            float desaturationAmount = smoothstep(0.8, 0.98, lum);
            vec3 satColor = mix(vec3(lum), agxColor, saturation);
            agxColor = mix(satColor, agxColor, desaturationAmount);
            
            return clamp(agxColor, 0.0, 1.0);
        }

        void main(void) {
            vec4 color = texture(textureSampler, vUV);
            color.rgb = sRGBToLinear(color.rgb);
            color.rgb = AgXTonemap(color.rgb);
            color.rgb = linearToSRGB(color.rgb);
            gl_FragColor = color;
        }`;

    const postProcess = new BABYLON.PostProcess(
        "AgX",
        shaderName,
        ["exposure", "scale", "contrast", "saturation", "time"],
        null,
        1.0,
        scene.activeCamera,
        BABYLON.Texture.BILINEAR_SAMPLINGMODE
    );

    scene.activeCamera.postProcesses.push(postProcess);

    // Move FXAA to the end if it exists
    if (pipeline.fxaaEnabled && scene.activeCamera.postProcesses.length > 1) {
        const processes = scene.activeCamera.postProcesses;
        for (let i = 0; i < processes.length; i++) {
            if (processes[i] instanceof BABYLON.FxaaPostProcess) {
                const fxaa = processes.splice(i, 1)[0];
                processes.push(fxaa);
                break;
            }
        }
    }

    // Update time in the shader
    let startTime = Date.now();
    postProcess.onApply = (effect) => {
        effect.setFloat("exposure", pipeline.imageProcessing.exposure);
        effect.setFloat2("scale", 1.0, 1.0);
        effect.setFloat("contrast", agxParams.contrast);
        effect.setFloat("saturation", agxParams.saturation);
        effect.setFloat("time", (Date.now() - startTime) / 1000.0);
    };

    return postProcess;
}; 