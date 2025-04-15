import * as BABYLON from '@babylonjs/core';
import { createAgXTonemap } from './agxTonemap';

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
    this.runningTime = 0;
    this.sceneConfig = null;
  }

  buildFromConfig(config) {
    this.sceneConfig = config;
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
      createAgXTonemap(scene, agxConfig, pipeline);
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
          new BABYLON.Vector3(...config.direction),
          scene
        );
        light.intensity = config.intensity || 1.0;
        
        // Set HDR-ready colors with proper gamma correction
        if (config.diffuse) {
          light.diffuse = new BABYLON.Color3(...config.diffuse);
        }
        if (config.groundColor) {
          light.groundColor = new BABYLON.Color3(...config.groundColor);
        }
        if (config.specular) {
          light.specular = new BABYLON.Color3(...config.specular);
        }

        // Enable smooth gradient transitions
        light.usePhysicalLights = true;
        light.range = 1000; // Large range for smooth falloff
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
    
    // Set diffuse color with HDR support
    if (config.diffuseColor) {
      material.diffuseColor = new BABYLON.Color3(...config.diffuseColor);
    }
    
    // Set specular color with HDR support
    if (config.specularColor) {
      material.specularColor = new BABYLON.Color3(...config.specularColor);
    }
    
    // Set specular power for smoother highlights
    if (config.specularPower) {
      material.specularPower = config.specularPower;
    }

    // Apply material settings from scene configuration
    const materialConfig = this.sceneConfig.rendering?.materials || {};
    
    // Enable physical lights if configured
    material.usePhysicalLights = config.usePhysicalLights ?? materialConfig.usePhysicalLights ?? true;
    
    // Enable specular anti-aliasing if configured
    material.useSpecularOverAlpha = config.useSpecularOverAlpha ?? materialConfig.useSpecularOverAlpha ?? true;
    material.useLogarithmicDepth = config.useLogarithmicDepth ?? materialConfig.useLogarithmicDepth ?? true;

    // Configure specular environment if enabled
    if (materialConfig.specularEnvironment?.enabled) {
      material.useSpecularOverAlpha = true;
      material.specularEnvironmentTexture = new BABYLON.CubeTexture(
        materialConfig.specularEnvironment.texture,
        scene
      );
      material.specularEnvironmentTexture.coordinatesMode = 
        BABYLON.Texture[materialConfig.specularEnvironment.coordinatesMode];
    }

    return material;
  }
}
