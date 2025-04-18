import * as BABYLON from '@babylonjs/core';

const DEFAULT_CUBEMAP_SIZE = 8;

// Create our own namespace for behaviors
class DynamicReflections {
    // Static list to track all active components
    static cubemapCamera = null;

    static components = [];
    static current = 0;

    constructor(mesh, params = {}) {
        this.mesh = mesh;
        this.scene = mesh.getScene();
        this.runningTime = 0;

        this.cubemapSize = params.cubemapSize || DEFAULT_CUBEMAP_SIZE;

        // Create render target texture for cubemap
        this.cubeRenderTarget = new BABYLON.RenderTargetTexture(
            "cubemap_" + mesh.name,
            this.cubemapSize,
            this.scene,
            true, // Generate mipmaps
            false, // Don't use linear rendering
            BABYLON.Engine.TEXTURETYPE_UNSIGNED_INT,
            true, // Is cube texture
            BABYLON.Texture.CUBIC_MODE,
            BABYLON.Texture.TRILINEAR_SAMPLINGMODE
        );

        // Create cameras for each face of the cubemap
        this.setupCubemapCamera();

        // Set up material for environment map
        if (this.mesh.material) {
            // Store original material properties
            this.originalMaterial = {
                reflectionTexture: this.mesh.material.reflectionTexture
            };

            // Set up reflection properties
            this.mesh.material.reflectionTexture = this.cubeRenderTarget;

            // this.mesh.material.reflectionTexture.coordinatesMode = BABYLON.Texture.CUBIC_MODE;

            // this.mesh.material.useGlossinessFromSpecularMapAlpha = true;
            // this.mesh.material.useReflectionFresnelFromSpecular = true;

            // this.mesh.material.reflectionFresnelParameters = new BABYLON.FresnelParameters();
            // this.mesh.material.reflectionFresnelParameters.bias = 0.1;
            // this.mesh.material.reflectionFresnelParameters.power = 2;
            // this.mesh.material.reflectionFresnelParameters.leftColor = BABYLON.Color3.White();
            // this.mesh.material.reflectionFresnelParameters.rightColor = BABYLON.Color3.Black();
        }
    }

    setupCubemapCamera() {
        // Create a new universal camera if it doesn't exist
        if (!DynamicReflections.cubemapCamera) {
            DynamicReflections.cubemapCamera = new BABYLON.Camera(
                "cubemapCamera",
                [0, 0, 0],
                this.scene
            );
            this.scene.onBeforeRenderObservable.add(() => {
                // DynamicReflections._updateAll();
            });
        }

        // Set up render targets for each face
        this.cubeRenderTarget.onBeforeRender = (faceIndex) => {
            const camera = DynamicReflections.cubemapCamera;
            if (!camera) return;

            // Hide the mesh during its own cubemap rendering
            this.mesh.isVisible = false;

            // Set the cubemap camera as the active camera
            this.originalCamera = this.scene.activeCamera;
            this.scene.activeCamera = camera;
        };

        this.cubeRenderTarget.onAfterRender = () => {
            // Restore mesh visibility
            this.mesh.isVisible = true;

            // Restore original camera
            if (this.originalCamera) {
                this.scene.activeCamera = this.originalCamera;
            }
        };

        // Set cameras for the render target
        this.cubeRenderTarget.customRenderFunction = (faceIndex, refreshRate) => {
            const camera = DynamicReflections.cubemapCamera;
            
            // Position camera at mesh center
            camera.position.copyFrom(this.mesh.position);

            // Set camera rotation based on face
            switch (faceIndex) {
                case 0: camera.rotation.set(0, Math.PI/2, 0); break;  // right
                case 1: camera.rotation.set(0, -Math.PI/2, 0); break; // left
                case 2: camera.rotation.set(-Math.PI/2, 0, 0); break; // up
                case 3: camera.rotation.set(Math.PI/2, 0, 0); break;  // down
                case 4: camera.rotation.set(0, 0, 0); break;          // front
                case 5: camera.rotation.set(0, Math.PI, 0); break;    // back
            }

            if (camera) {
                this.scene.render(refreshRate, false, camera);
            }
        };
    }

    static _updateAll() {
        if (DynamicReflections.components.length === 0) return;

        const component = DynamicReflections.components[DynamicReflections.current];
        
        if (component && component.mesh) {
            component._update();
        }

        DynamicReflections.current = (DynamicReflections.current + 1) % DynamicReflections.components.length;
    }

    _update() {
        // Update running time
        this.runningTime += this.scene.getEngine().getDeltaTime() / 1000;
        
        // Update all cubemap faces
        this.cubeRenderTarget.render();
        console.log(`Cubemap updated for: ${this.mesh.name}`);

        // Assign the cubemap texture to the debug material
        if (true) {
            const debugMaterial = this.scene.getMaterialByName("debugMaterial");
            if (debugMaterial) {
                debugMaterial.reflectionTexture = this.cubeRenderTarget;
            }
        }
    }

    dispose() {
        // Restore original material properties
        if (this.mesh.material && this.originalMaterial) {
            this.mesh.material.reflectionTexture = this.originalMaterial.reflectionTexture;
        }

        // Dispose of resources
        if (this.cubeRenderTarget) {
            this.cubeRenderTarget.dispose();
        }
        if (this.cubeCameras) {
            this.cubeCameras.forEach(camera => camera.dispose());
        }

        // Remove from active components
        const index = DynamicReflections.components.indexOf(this);
        if (index !== -1) {
            DynamicReflections.components.splice(index, 1);
        }

        // If no more components, stop the global update
        if (DynamicReflections.components.length === 0) {
            DynamicReflections.isUpdating = false;
            this.scene.unregisterBeforeRender(DynamicReflections._updateAll);
        }

        // console.log(`CustomComponent disposed for: ${this.mesh.name}`);
    }

    static AddToMesh(mesh, params = {}) {
        const component = new DynamicReflections(mesh, params);
        DynamicReflections.components.push(component);
    }
};

export { DynamicReflections };
