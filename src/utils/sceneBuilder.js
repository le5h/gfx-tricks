import * as BABYLON from '@babylonjs/core';

// AgX tonemapping constants
const AGX_CONSTANTS = {
    SLOPE: 0.98,
    TOE: 0.55,
    SHOULDER: 0.0,
    LINEAR_SECTION: [0.18, 0.18],
    LINEAR_SLOPE: 0.98,
    EXPOSURE_BIAS: 0.0
};

export class SceneBuilder {
  constructor(engine, canvas) {
    this.engine = engine;
    this.canvas = canvas;
  }

  buildFromConfig(config) {
    const scene = new BABYLON.Scene(this.engine);
    scene.clearColor = new BABYLON.Color4(...config.clearColor || [0, 0, 0, 1]);

    // Create camera first (needed for post-processes)
    if (config.camera) {
      this.createCamera(scene, config.camera);
    }

    // Apply rendering configuration
    if (config.rendering) {
      this.applyRenderingConfig(scene, config.rendering);
    }

    // Create lights
    if (config.lights) {
      config.lights.forEach(lightConfig => {
        this.createLight(scene, lightConfig);
      });
    }

    // Create materials
    if (config.materials) {
      config.materials.forEach(materialConfig => {
        this.createMaterial(scene, materialConfig);
      });
    }

    // Create meshes
    if (config.meshes) {
      config.meshes.forEach(meshConfig => {
        this.createMesh(scene, meshConfig);
      });
    }

    // Create post-processes last
    if (config.postProcesses) {
      this.createPostProcesses(scene, config.postProcesses);
    }

    return scene;
  }

  applyRenderingConfig(scene, config) {
    // Enable HDR pipeline
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);
    
    // Important: Set up HDR rendering
    const engine = scene.getEngine();
    engine.setHardwareScalingLevel(1.0);

    // Create default pipeline first
    const pipeline = new BABYLON.DefaultRenderingPipeline(
      "defaultPipeline",
      true,
      scene,
      [scene.activeCamera]
    );

    // Configure HDR and tonemapping
    const defaultExposure = 1.0;
    const defaultContrast = 1.2;

    // Determine which tonemapping to use
    const toneMappingEnabled = config.imageProcessing?.toneMapping !== false;
    const useAgX = toneMappingEnabled && config.imageProcessing?.agx?.enabled !== false;
    
    // Configure tonemapping based on settings
    scene.imageProcessingConfiguration.toneMappingEnabled = toneMappingEnabled && !useAgX;
    pipeline.imageProcessing.toneMappingEnabled = toneMappingEnabled && !useAgX;

    if (toneMappingEnabled && !useAgX) {
      // Use Babylon's built-in ACES tone mapping when AgX is disabled
      scene.imageProcessingConfiguration.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
      pipeline.imageProcessing.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
    }

    // Configure exposure and contrast
    scene.imageProcessingConfiguration.exposure = config.imageProcessing?.exposure ?? defaultExposure;
    scene.imageProcessingConfiguration.contrast = config.imageProcessing?.contrast ?? defaultContrast;
    pipeline.imageProcessing.exposure = config.imageProcessing?.exposure ?? defaultExposure;
    pipeline.imageProcessing.contrast = config.imageProcessing?.contrast ?? defaultContrast;

    // Set up FXAA after tonemapping
    if (config.antialiasing) {
      pipeline.fxaaEnabled = true;
      pipeline.samples = 1; // Use FXAA instead of MSAA
    }

    // Create AgX tonemapping if enabled
    if (useAgX) {
      const agxConfig = config.imageProcessing?.agx || {};
      this.createAgXTonemap(scene, agxConfig, pipeline);
    }

    // Set shadows
    if (config.shadows && config.shadows.enabled) {
      scene.shadowsEnabled = true;
    }

    // Set environment
    if (config.environment) {
      if (config.environment.skybox) {
        const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: 1000.0 }, scene);
        const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", scene);
        skyboxMaterial.backFaceCulling = false;
        skyboxMaterial.reflectionTexture = new BABYLON.CubeTexture(config.environment.skybox, scene);
        skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        skyboxMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
        skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
        skybox.material = skyboxMaterial;
      }
    }
  }

  createPostProcesses(scene, configs) {
    if (!scene.activeCamera) {
      console.warn('No active camera found for post-processes');
      return;
    }

    const pipeline = new BABYLON.DefaultRenderingPipeline(
      "defaultPipeline",
      true,
      scene,
      [scene.activeCamera]
    );

    configs.forEach(config => {
      switch (config.type) {
        case 'bloom':
          pipeline.bloomEnabled = true;
          pipeline.bloomThreshold = config.threshold || 0.0;
          pipeline.bloomWeight = config.intensity || 1.0;
          pipeline.bloomKernel = config.size || 10;
          break;

        case 'glow':
          pipeline.glowLayerEnabled = true;
          pipeline.glowLayer.intensity = config.intensity || 1.0;
          pipeline.glowLayer.blurKernelSize = config.blurKernelSize || 32;
          break;

        case 'ssao':
          pipeline.ssaoEnabled = true;
          pipeline.ssaoRatio = config.ratio || 0.5;
          pipeline.ssaoBlurScale = config.blurScale || 1.0;
          break;

        default:
          throw new Error(`Unsupported post-process type: ${config.type}`);
      }
    });
  }

  createCamera(scene, config) {
    switch (config.type) {
      case 'arcRotate':
        const camera = new BABYLON.ArcRotateCamera(
          config.name,
          config.alpha || -Math.PI / 2,
          config.beta || Math.PI / 2.5,
          config.radius || 3,
          new BABYLON.Vector3(...config.target || [0, 0, 0]),
          scene
        );
        camera.attachControl(this.canvas, true);
        return camera;

      case 'free':
        const freeCamera = new BABYLON.FreeCamera(
          config.name,
          new BABYLON.Vector3(...config.position || [0, 5, -10]),
          scene
        );
        freeCamera.attachControl(this.canvas, true);
        return freeCamera;

      default:
        throw new Error(`Unsupported camera type: ${config.type}`);
    }
  }

  createLight(scene, config) {
    let light;
    switch (config.type) {
      case 'hemispheric':
        light = new BABYLON.HemisphericLight(
          config.name,
          new BABYLON.Vector3(...config.direction || [0, 1, 0]),
          scene
        );
        break;

      case 'point':
        light = new BABYLON.PointLight(
          config.name,
          new BABYLON.Vector3(...config.position || [0, 10, 0]),
          scene
        );
        break;

      case 'directional':
        light = new BABYLON.DirectionalLight(
          config.name,
          new BABYLON.Vector3(...config.direction || [0, -1, 0]),
          scene
        );
        if (config.position) {
          light.position = new BABYLON.Vector3(...config.position);
        }
        break;

      default:
        throw new Error(`Unsupported light type: ${config.type}`);
    }

    // Set light intensity
    if (config.intensity !== undefined) {
      light.intensity = config.intensity;
    }

    // Configure shadows if enabled
    if (config.shadows && config.shadows.enabled) {
      const shadowGenerator = new BABYLON.ShadowGenerator(
        config.shadows.mapSize || 1024,
        light
      );
      
      // Configure shadow quality
      if (config.shadows.quality) {
        const qualityMap = {
          'low': {
            useBlurExponentialShadowMap: false,
            useKernelBlur: false,
            blurKernel: 1
          },
          'medium': {
            useBlurExponentialShadowMap: true,
            useKernelBlur: true,
            blurKernel: 8
          },
          'high': {
            useBlurExponentialShadowMap: true,
            useKernelBlur: true,
            blurKernel: 16
          }
        };

        const quality = qualityMap[config.shadows.quality] || qualityMap.medium;
        shadowGenerator.useBlurExponentialShadowMap = quality.useBlurExponentialShadowMap;
        shadowGenerator.useKernelBlur = quality.useKernelBlur;
        shadowGenerator.blurKernel = quality.blurKernel;
      }

      // Configure shadow bias
      if (config.shadows.bias !== undefined) {
        shadowGenerator.bias = config.shadows.bias;
      }
      if (config.shadows.normalBias !== undefined) {
        shadowGenerator.normalBias = config.shadows.normalBias;
      }

      // Set up shadow frustum for directional lights
      if (light instanceof BABYLON.DirectionalLight) {
        // Use PCF shadows for better quality
        shadowGenerator.usePercentageCloserFiltering = true;
        shadowGenerator.filteringQuality = BABYLON.ShadowGenerator.QUALITY_HIGH;
        
        // Disable poisson sampling as PCF gives better results
        shadowGenerator.usePoissonSampling = false;
        shadowGenerator.useExponentialShadowMap = false;
        
        // Configure shadow frustum
        const shadowFrustumSize = 20;
        light.shadowOrthoScale = 0.7;
        light.shadowMinZ = 1;
        light.shadowMaxZ = 30;
        
        // Enable contact hardening for more realistic shadows
        shadowGenerator.contactHardeningLightSizeUVRatio = 0.05;
      }

      // Store shadow generator for mesh configuration
      light.shadowGenerator = shadowGenerator;
    }

    return light;
  }

  createMesh(scene, config) {
    let mesh;
    switch (config.type) {
      case 'sphere':
        mesh = BABYLON.MeshBuilder.CreateSphere(
          config.name,
          { diameter: config.diameter || 2 },
          scene
        );
        break;

      case 'box':
        mesh = BABYLON.MeshBuilder.CreateBox(
          config.name,
          { size: config.size || 1 },
          scene
        );
        break;

      case 'ground':
        mesh = BABYLON.MeshBuilder.CreateGround(
          config.name,
          { width: config.width || 10, height: config.height || 10 },
          scene
        );
        break;

      default:
        throw new Error(`Unsupported mesh type: ${config.type}`);
    }

    // Apply position if specified
    if (config.position) {
      mesh.position = new BABYLON.Vector3(...config.position);
    }

    // Apply rotation if specified
    if (config.rotation) {
      mesh.rotation = new BABYLON.Vector3(...config.rotation);
    }

    // Apply material if specified
    if (config.material) {
      mesh.material = scene.getMaterialByName(config.material);
    }

    // Configure shadows if enabled
    if (config.shadows && config.shadows.enabled) {
      // Find the light that should cast shadows on this mesh
      const light = scene.lights.find(l => l.shadowGenerator);
      if (light && light.shadowGenerator) {
        if (config.shadows.dropShadow) {
          light.shadowGenerator.addShadowCaster(mesh, true);
        }
        if (config.shadows.receiveShadows) {
          mesh.receiveShadows = true;
        }
      }
    }

    return mesh;
  }

  createMaterial(scene, config) {
    const material = new BABYLON.StandardMaterial(config.name, scene);
    
    if (config.diffuseColor) {
      material.diffuseColor = new BABYLON.Color3(...config.diffuseColor);
    }
    
    if (config.specularColor) {
      material.specularColor = new BABYLON.Color3(...config.specularColor);
    }
    
    if (config.emissiveColor) {
      material.emissiveColor = new BABYLON.Color3(...config.emissiveColor);
    }
    
    if (config.alpha !== undefined) {
      material.alpha = config.alpha;
    }

    return material;
  }

  // AgX tonemapping implementation
  createAgXTonemap(scene, config = {}, pipeline) {
    const shaderName = "agx";
    
    if (!scene.activeCamera) {
      console.warn('No active camera found for AgX tonemapping');
      return;
    }

    if (!scene.activeCamera.postProcesses) {
      scene.activeCamera.postProcesses = [];
    }

    // AgX parameters tuned for better shadow detail and highlight handling
    const agxParams = {
      slope: config.slope ?? 0.91,
      toe: config.toe ?? 0.53,         // Reduced toe for better shadow detail
      shoulder: config.shoulder ?? 0.95,
      linearStart: config.linearStart ?? 0.1,  // Lower start for more shadow detail
      linearLength: config.linearLength ?? 0.7, // Extended for smoother transitions
      linearSlope: config.linearSlope ?? 0.91,
      exposureBias: config.exposureBias ?? 0.0, // Neutral bias for better balance
      contrast: config.contrast ?? 1.0,
      saturation: config.saturation ?? 1.0
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

      const float SLOPE = ${agxParams.slope.toFixed(6)};
      const float TOE = ${agxParams.toe.toFixed(6)};
      const float SHOULDER = ${agxParams.shoulder.toFixed(6)};
      const vec2 LINEAR_SECTION = vec2(${agxParams.linearStart.toFixed(6)}, ${agxParams.linearLength.toFixed(6)});
      const float LINEAR_SLOPE = ${agxParams.linearSlope.toFixed(6)};
      const float EXPOSURE_BIAS = ${agxParams.exposureBias.toFixed(6)};

      // More accurate sRGB conversion with smooth handling
      vec3 sRGBToLinear(vec3 color) {
          bvec3 cutoff = lessThan(color, vec3(0.04045));
          vec3 higher = pow((color + vec3(0.055))/vec3(1.055), vec3(2.4));
          vec3 lower = color/vec3(12.92);
          return mix(higher, lower, cutoff);
      }

      // Improved color space conversion matrices for better hue preservation
      const mat3 RGB_2_AP1 = mat3(
          0.6170, 0.3400, 0.0430,
          0.0700, 0.9300, 0.0000,
          0.0200, 0.0880, 0.8920
      );
      
      const mat3 AP1_2_RGB = mat3(
          1.7050, -0.6242, -0.0808,
          -0.1297, 1.1380, -0.0083,
          -0.0241, -0.1280, 1.1520
      );

      vec3 transformColor(vec3 color) {
          return RGB_2_AP1 * color;
      }

      vec3 inverseTransformColor(vec3 color) {
          return AP1_2_RGB * color;
      }

      // Smooth highlight compression function
      float smoothCompress(float x, float knee, float ratio) {
          float dist = max(0.0, x - knee);
          return knee + dist / (1.0 + (ratio * dist / knee));
      }

      // Improved highlight desaturation with better hue preservation
      vec3 desaturateHighlights(vec3 color) {
          vec3 ap1 = transformColor(color);
          float luminance = dot(ap1, vec3(0.2722287168, 0.6740817658, 0.0536895174));
          float maxChannel = max(max(ap1.r, ap1.g), ap1.b);
          
          // Smoother desaturation curve
          float desatStart = 0.7;
          float desatEnd = 2.0;
          float t = (maxChannel - desatStart) / (desatEnd - desatStart);
          float desatAmount = smoothstep(0.0, 1.0, t);
          
          // Preserve hue while reducing saturation
          vec3 desaturated = mix(ap1, vec3(luminance), desatAmount);
          return inverseTransformColor(desaturated);
      }

      vec3 AgXTonemap(vec3 color) {
          // Pre-exposure adjustment for shadow detail
          color = color * pow(2.0, EXPOSURE_BIAS);
          color *= exposure;
          
          // Convert to AP1 color space for better color handling
          color = transformColor(color);
          
          vec3 agxColor;
          for(int i = 0; i < 3; i++) {
              float x = max(0.0, color[i]);
              
              // Enhanced toe region with better shadow detail
              if(x < LINEAR_SECTION[0]) {
                  float t = x / LINEAR_SECTION[0];
                  // Smoother toe curve for better shadow detail
                  float toeStrength = mix(1.0, SLOPE, t);
                  x = TOE * pow(t, toeStrength);
              }
              // Extended linear section for smoother transitions
              else if(x >= LINEAR_SECTION[0] && x <= LINEAR_SECTION[1]) {
                  float t = (x - LINEAR_SECTION[0]) / (LINEAR_SECTION[1] - LINEAR_SECTION[0]);
                  float linearValue = LINEAR_SLOPE * (x - LINEAR_SECTION[0]) + TOE;
                  float toeValue = TOE * pow(1.0, SLOPE);
                  x = mix(toeValue, linearValue, smoothstep(0.0, 1.0, t));
              }
              // Improved shoulder compression
              else {
                  float t = (x - LINEAR_SECTION[1]) / (3.0 - LINEAR_SECTION[1]);
                  // Smooth compression curve
                  float compressed = smoothCompress(t, 0.5, 1.5);
                  x = mix(
                      TOE + LINEAR_SLOPE * (LINEAR_SECTION[1] - LINEAR_SECTION[0]),
                      1.0,
                      compressed
                  );
              }
              
              agxColor[i] = x;
          }

          // Convert back to RGB with smooth highlight handling
          agxColor = inverseTransformColor(agxColor);
          
          // Apply highlight desaturation before contrast
          agxColor = desaturateHighlights(agxColor);
          
          // Improved contrast application that preserves shadow detail
          float avgLuma = dot(agxColor, vec3(0.2126, 0.7152, 0.0722));
          vec3 contrastedColor = pow(max(agxColor, vec3(0.0001)), vec3(contrast));
          float newLuma = dot(contrastedColor, vec3(0.2126, 0.7152, 0.0722));
          agxColor = contrastedColor * (avgLuma / max(newLuma, 0.0001));

          // Improved saturation handling that preserves shadows
          float luma = dot(agxColor, vec3(0.2126, 0.7152, 0.0722));
          vec3 satColor = mix(vec3(luma), agxColor, saturation);
          float preserveShadows = 1.0 - smoothstep(0.0, 0.3, luma);
          float preserveHighlights = 1.0 - smoothstep(0.7, 1.0, luma);
          agxColor = mix(satColor, agxColor, max(preserveShadows, preserveHighlights));
          
          return clamp(agxColor, 0.0, 1.0);
      }

      void main(void) {
          vec4 color = texture2D(textureSampler, vUV);
          color.rgb = sRGBToLinear(color.rgb);
          color.rgb = AgXTonemap(color.rgb);
          gl_FragColor = color;
      }`;

    const postProcess = new BABYLON.PostProcess(
      "AgX",
      shaderName,
      ["exposure", "scale", "contrast", "saturation"],
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

    postProcess.onApply = (effect) => {
      effect.setFloat("exposure", pipeline.imageProcessing.exposure);
      effect.setFloat2("scale", 1.0, 1.0);
      effect.setFloat("contrast", agxParams.contrast);
      effect.setFloat("saturation", agxParams.saturation);
    };

    return postProcess;
  }
}
