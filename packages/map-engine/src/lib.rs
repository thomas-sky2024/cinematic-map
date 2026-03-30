use serde::{Deserialize, Serialize};

#[cfg(not(target_arch = "wasm32"))]
use rayon::prelude::*;

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    pub id: String,
    pub label: String,
    pub time: f64,
    pub lat: f64,
    pub lng: f64,
    pub zoom: f64,
    pub pitch: f64,
    pub bearing: f64,
    pub easing: EasingType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EasingType {
    Linear,
    EaseInOut,
    CinematicArc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameCamera {
    pub frame: u32,
    pub time: f64,
    pub lat: f64,
    pub lng: f64,
    pub zoom: f64,
    pub pitch: f64,
    pub bearing: f64,
}

// ── Public API ─────────────────────────────────────────────────────────────

pub fn compute_frames(kfs: &[Keyframe], fps: u32) -> Vec<FrameCamera> {
    if kfs.len() < 2 { return vec![]; }

    let total_time   = kfs.last().map(|k| k.time).unwrap_or(0.0);
    let total_frames = (total_time * fps as f64).ceil() as u32;

    #[cfg(not(target_arch = "wasm32"))]
    {
        (0..total_frames)
            .into_par_iter()
            .map(|frame| {
                let t = frame as f64 / fps as f64;
                interpolate_at(kfs, t, frame)
            })
            .collect()
    }

    #[cfg(target_arch = "wasm32")]
    {
        (0..total_frames)
            .map(|frame| {
                let t = frame as f64 / fps as f64;
                interpolate_at(kfs, t, frame)
            })
            .collect()
    }
}

pub fn interpolate_single(kfs: &[Keyframe], time: f64) -> Option<FrameCamera> {
    if kfs.len() < 2 { return None; }
    Some(interpolate_at(kfs, time, (time * 30.0) as u32))
}

// ── Interpolation math ────────────────────────────────────────────────────

fn interpolate_at(kfs: &[Keyframe], t: f64, frame: u32) -> FrameCamera {
    let (from, to, local_t) = find_segment(kfs, t);
    let et      = apply_easing(local_t, &from.easing);
    let dist_km = haversine_km(from.lat, from.lng, to.lat, to.lng);

    let arc = match &from.easing {
        EasingType::CinematicArc if dist_km > 500.0 => {
            (local_t * std::f64::consts::PI).sin() * (dist_km / 2000.0).min(1.5)
        }
        _ => 0.0,
    };

    FrameCamera {
        frame,
        time: t,
        lat:     lerp(from.lat,     to.lat,     et),
        lng:     lerp_angle(from.lng,     to.lng,     et),
        zoom:    lerp(from.zoom,    to.zoom,    et) - arc,
        pitch:   lerp(from.pitch,   to.pitch,   et),
        bearing: lerp_angle(from.bearing, to.bearing, et),
    }
}

fn find_segment<'a>(kfs: &'a [Keyframe], t: f64) -> (&'a Keyframe, &'a Keyframe, f64) {
    if t <= kfs[0].time { return (&kfs[0], &kfs[1], 0.0); }
    let last = kfs.len() - 1;
    if t >= kfs[last].time { return (&kfs[last - 1], &kfs[last], 1.0); }
    for i in 0..last {
        let (from, to) = (&kfs[i], &kfs[i + 1]);
        if t >= from.time && t <= to.time {
            let seg = to.time - from.time;
            let lt  = if seg > 0.0 { (t - from.time) / seg } else { 0.0 };
            return (from, to, lt.clamp(0.0, 1.0));
        }
    }
    (&kfs[last - 1], &kfs[last], 1.0)
}

fn lerp(a: f64, b: f64, t: f64) -> f64 { a + (b - a) * t }

fn lerp_angle(a: f64, b: f64, t: f64) -> f64 {
    let mut d = b - a;
    if d > 180.0  { d -= 360.0; }
    if d < -180.0 { d += 360.0; }
    a + d * t
}

fn apply_easing(t: f64, easing: &EasingType) -> f64 {
    match easing {
        EasingType::Linear       => t,
        EasingType::EaseInOut    => smoothstep(t),
        EasingType::CinematicArc => smoothstep(smoothstep(t)),
    }
}

fn smoothstep(t: f64) -> f64 { t * t * (3.0 - 2.0 * t) }

fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 6371.0;
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlon / 2.0).sin().powi(2);
    2.0 * R * a.sqrt().asin()
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn kf(id: &str, time: f64, lat: f64, lng: f64, zoom: f64, pitch: f64, bearing: f64) -> Keyframe {
        Keyframe { id: id.into(), label: id.into(), time, lat, lng, zoom, pitch, bearing, easing: EasingType::EaseInOut }
    }

    fn sample_kfs() -> Vec<Keyframe> {
        vec![
            kf("start", 0.0, 12.66, 108.05, 5.0,  0.0,   0.0),
            kf("end",   5.0, 21.02, 105.83, 12.0, 60.0, -20.0),
        ]
    }

    // ── Frame count ──────────────────────────────────────────────────────────

    #[test]
    fn compute_returns_correct_count() {
        assert_eq!(compute_frames(&sample_kfs(), 30).len(), 150); // 5s × 30fps
    }

    #[test]
    fn compute_returns_correct_count_60fps() {
        assert_eq!(compute_frames(&sample_kfs(), 60).len(), 300);
    }

    #[test]
    fn single_keyframe_returns_empty() {
        let kfs = vec![kf("a", 0.0, 0.0, 0.0, 5.0, 0.0, 0.0)];
        assert!(compute_frames(&kfs, 30).is_empty());
    }

    // ── Boundary values ──────────────────────────────────────────────────────

    #[test]
    fn first_frame_matches_start() {
        let f = &compute_frames(&sample_kfs(), 30)[0];
        assert!((f.lat  - 12.66).abs() < 0.001);
        assert!((f.zoom -  5.0 ).abs() < 0.001);
        assert!( f.time.abs()          < 0.001);
    }

    #[test]
    fn last_frame_approaches_end() {
        let frames = compute_frames(&sample_kfs(), 30);
        let f = frames.last().unwrap();
        assert!((f.lat - 21.02).abs() < 0.05);
        assert!((f.zoom - 12.0).abs() < 0.05);
    }

    // ── interpolate_single ───────────────────────────────────────────────────

    #[test]
    fn interpolate_single_midpoint() {
        let kfs = sample_kfs();
        let cam = interpolate_single(&kfs, 2.5).unwrap();
        // At t=2.5 (midpoint) EaseInOut smoothstep(0.5)=0.5 → values between start/end
        assert!(cam.lat  > 12.66 && cam.lat  < 21.02);
        assert!(cam.zoom >  5.0  && cam.zoom < 12.0);
    }

    #[test]
    fn interpolate_single_before_start_clamps_to_start() {
        let cam = interpolate_single(&sample_kfs(), -1.0).unwrap();
        assert!((cam.lat - 12.66).abs() < 0.01);
    }

    #[test]
    fn interpolate_single_after_end_clamps_to_end() {
        let cam = interpolate_single(&sample_kfs(), 100.0).unwrap();
        assert!((cam.lat - 21.02).abs() < 0.01);
    }

    #[test]
    fn interpolate_single_requires_two_keyframes() {
        let kfs = vec![kf("a", 0.0, 0.0, 0.0, 5.0, 0.0, 0.0)];
        assert!(interpolate_single(&kfs, 0.5).is_none());
    }

    // ── Angle interpolation (shortest path) ──────────────────────────────────

    #[test]
    fn bearing_takes_shortest_path_across_180() {
        let kfs = vec![
            kf("a", 0.0, 0.0, 0.0, 5.0, 0.0,  170.0),
            kf("b", 1.0, 0.0, 0.0, 5.0, 0.0, -170.0),
        ];
        let cam = interpolate_single(&kfs, 0.5).unwrap();
        // Shortest path: +170 → -170 through 180, midpoint ≈ ±180
        assert!(cam.bearing.abs() > 170.0 || cam.bearing.abs() < 10.0);
    }

    // ── Easing ───────────────────────────────────────────────────────────────

    #[test]
    fn linear_easing_midpoint_is_exact_midpoint() {
        let kfs = vec![
            Keyframe { id: "a".into(), label: "".into(), time: 0.0, lat: 0.0, lng: 0.0, zoom: 0.0, pitch: 0.0, bearing: 0.0, easing: EasingType::Linear },
            Keyframe { id: "b".into(), label: "".into(), time: 2.0, lat: 10.0, lng: 0.0, zoom: 10.0, pitch: 0.0, bearing: 0.0, easing: EasingType::Linear },
        ];
        let cam = interpolate_single(&kfs, 1.0).unwrap();
        assert!((cam.lat  - 5.0).abs() < 0.001);
        assert!((cam.zoom - 5.0).abs() < 0.001);
    }

    // ── Cinematic arc ─────────────────────────────────────────────────────────

    #[test]
    fn cinematic_arc_pulls_back_zoom_on_long_distance() {
        let kfs = vec![
            Keyframe { id: "a".into(), label: "".into(), time: 0.0, lat: 0.0, lng: 0.0, zoom: 12.0, pitch: 0.0, bearing: 0.0, easing: EasingType::CinematicArc },
            Keyframe { id: "b".into(), label: "".into(), time: 5.0, lat: 40.0, lng: 0.0, zoom: 12.0, pitch: 0.0, bearing: 0.0, easing: EasingType::CinematicArc },
        ];
        let cam = interpolate_single(&kfs, 2.5).unwrap();
        // Should pull zoom back (arc) at midpoint over ~4400km route
        assert!(cam.zoom < 12.0, "Cinematic arc should reduce zoom at midpoint");
    }

    // ── Multi-segment ─────────────────────────────────────────────────────────

    #[test]
    fn three_keyframes_transitions_correctly() {
        let kfs = vec![
            kf("a", 0.0,  0.0, 0.0,  5.0, 0.0, 0.0),
            kf("b", 5.0, 10.0, 0.0, 10.0, 0.0, 0.0),
            kf("c", 10.0, 20.0, 0.0, 15.0, 0.0, 0.0),
        ];
        let frames = compute_frames(&kfs, 30);
        assert_eq!(frames.len(), 300); // 10s × 30fps

        // At t=5 we should be exactly at keyframe b
        let mid = interpolate_single(&kfs, 5.0).unwrap();
        assert!((mid.lat - 10.0).abs() < 0.01);
        assert!((mid.zoom - 10.0).abs() < 0.01);
    }

    // ── haversine ─────────────────────────────────────────────────────────────

    #[test]
    fn haversine_hanoi_to_hcmc() {
        // Hanoi ↔ Ho Chi Minh City ≈ 1140 km
        let d = haversine_km(21.028, 105.834, 10.762, 106.660);
        assert!((d - 1140.0).abs() < 30.0, "Got {d:.1} km");
    }

    #[test]
    fn haversine_same_point_is_zero() {
        let d = haversine_km(12.0, 108.0, 12.0, 108.0);
        assert!(d.abs() < 0.001);
    }
}
