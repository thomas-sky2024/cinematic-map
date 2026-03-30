use std::io::stdout;

#[tokio::main]
async fn main() -> Result<(), String> {
    // Default config for CLI/render.sh
    let width = 1920;
    let height = 1080;
    let fps = 30;
    
    // Style: default to a beautiful maplibre style (e.g. MapTiler)
    // In actual usage, this could be passed via CLI
    let style_url = "https://demotiles.maplibre.org/style.json".to_string();

    // Hanoi Keyframes
    let keyframes = vec![
        map_engine::Keyframe { 
            id: "1".into(), label: "1".into(), time: 0.0, 
            lat: 21.0285, lng: 105.8542, zoom: 12.0, pitch: 0.0, bearing: 0.0,
            easing: map_engine::EasingType::EaseInOut 
        },
        map_engine::Keyframe { 
            id: "2".into(), label: "2".into(), time: 4.0, 
            lat: 21.0333, lng: 105.8333, zoom: 14.5, pitch: 45.0, bearing: 90.0,
            easing: map_engine::EasingType::CinematicArc 
        },
    ];

    eprintln!("[map-engine] CLI starting real render with MapLibre Native...");
    
    map_engine::render::render_to_stream(
        stdout(),
        keyframes,
        fps,
        width,
        height,
        style_url,
        |curr, total| {
            eprint!("\r[map-engine] Render Progress: {}/{}", curr, total);
        }
    ).await?;

    eprintln!("\n[map-engine] CLI Render finished.");
    Ok(())
}
