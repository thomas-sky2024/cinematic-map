import { Composition, CalculateMetadataFunction } from "remotion";
import { CinematicMapComposition } from "./Composition";
import { FrameCamera, Annotation } from "@cinematic-map/ui-core";

export interface CinematicMapProps extends Record<string, unknown> {
  frames: FrameCamera[];
  annotations: Annotation[];
  mapStyleId: string;
  mapToken: string;
  terrainEnabled: boolean;
  fps: number;
  width?: number;
  height?: number;
}

const calculateMetadata: CalculateMetadataFunction<CinematicMapProps> = ({ props }) => {
  const maxFrame = Math.max(...props.frames.map((f: FrameCamera) => f.frame), 0);
  return {
    durationInFrames: Math.max(1, maxFrame + 1),
    fps: props.fps || 30,
    width: props.width || 1920,
    height: props.height || 1080,
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="CinematicMap"
        component={CinematicMapComposition as any}
        durationInFrames={300} 
        fps={30}               
        width={1920}           
        height={1080}          
        calculateMetadata={calculateMetadata}
        defaultProps={{
          frames: [],
          annotations: [],
          mapStyleId: "dark",
          mapToken: "",
          terrainEnabled: false,
          fps: 30,
        }}
      />
    </>
  );
};
