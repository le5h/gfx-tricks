import { useEffect, useRef } from 'preact/hooks';
import * as BABYLON from '@babylonjs/core';

import { SceneBuilder } from './utils/sceneBuilder';

import sampleScene from './scenes/sampleScene.json';



export default function App() {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Create the Babylon.js engine
    const engine = new BABYLON.Engine(canvasRef.current, true);

    // Create scene builder and build the scene
    const sceneBuilder = new SceneBuilder(engine, canvasRef.current);
    const scene = sceneBuilder.buildFromConfig(sampleScene);

    // Run the render loop
    engine.runRenderLoop(() => {
      scene.render();
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      engine.resize();
    });

    // Cleanup
    return () => {
      engine.dispose();
    };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
} 