import { bundle } from "@remotion/bundler";
import { renderMedia, getCompositions } from "@remotion/renderer";
import path from "path";
import fs from "fs";
import os from "os";

async function main() {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf("--config");
  const configFileIndex = args.indexOf("--config-file");
  const outputIndex = args.indexOf("--output");

  if ((configIndex === -1 && configFileIndex === -1) || outputIndex === -1) {
    console.error("Usage: remotion-renderer --config <json> | --config-file <path> --output <path>");
    process.exit(1);
  }

  let config;
  if (configFileIndex !== -1) {
    const configPath = args[configFileIndex + 1];
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } else {
    config = JSON.parse(args[configIndex + 1]);
  }
  const outputPath = args[outputIndex + 1];

  const entry = path.join(__dirname, "index.ts"); // Remotion entry point
  
  console.error(JSON.stringify({ stage: "bundling", encoded: 0, total: 100, fps: 0 }));

  const bundleLocation = await bundle(entry);

  const chromiumOptions = {
    gl: "angle" as const,
  };

  const compositions = await getCompositions(bundleLocation, {
    inputProps: config,
    chromiumOptions,
  });

  const composition = compositions.find((c) => c.id === "CinematicMap");
  if (!composition) {
    console.error("Composition CinematicMap not found");
    process.exit(1);
  }

  console.error(JSON.stringify({ stage: "rendering", encoded: 0, total: composition.durationInFrames, fps: 0 }));

  const cpus = os.cpus().length;
  const concurrency = Math.max(1, cpus - 1); 

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: (config.animationConfig?.codec as any) || "h264",
    outputLocation: outputPath,
    inputProps: config,
    chromiumOptions,
    concurrency,
    onProgress: ({ renderedFrames }) => {
      console.error(
        JSON.stringify({
          stage: "encoding",
          encoded: renderedFrames,
          total: composition.durationInFrames,
          fps: 0,
        })
      );
    },
  });

  console.error(JSON.stringify({ stage: "done", encoded: composition.durationInFrames, total: composition.durationInFrames, fps: 0 }));
}

main().catch((err) => {
  console.error(JSON.stringify({ stage: "error", error: err.message }));
  process.exit(1);
});
