use serde::{Deserialize, Serialize};

#[cfg(not(target_arch = "wasm32"))]
use rayon::prelude::*;

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    pub id: String,
    pub label: String,
    pub time: f64,   // seconds
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

/// Compute all frame cameras from keyframes.
/// Uses rayon parallel on native (M1 P+E cores), sequential on WASM.
pub fn compute_frames(kfs: &[Keyframe], fps: u32) -> Vec<FrameCamera> {
    if kfs.len() < 2 {
        return vec![];
    }

    let total_time = kfs.last().map(|k| k.time).unwrap_or(0.0);
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

/// Interpolate a single point in time.
pub fn interpolate_single(kfs: &[Keyframe], time: f64) -> Option<FrameCamera> {
    if kfs.len() < 2 {
        return None;
    }
    Some(interpolate_at(kfs, time, (time * 30.0) as u32))
}

// ── Interpolation math ────────────────────────────────────────────────────

fn interpolate_at(kfs: &[Keyframe], t: f64, frame: u32) -> FrameCamera {
    let (from, to, local_t) = find_segment(kfs, t);

    let et = apply_easing(local_t, &from.easing);

    // Zoom arc: only for CinematicArc easing — a subtle pull-back over very long distances.
    // Intentionally NOT applied to EaseInOut/Linear to avoid unwanted altitude spikes.
    let dist_km = haversine_km(from.lat, from.lng, to.lat, to.lng);
    let arc = match &from.easing {
        EasingType::CinematicArc if dist_km > 500.0 => {
            // Gentle arc: max 1.5 zoom levels out, only for truly long hauls (>500 km)
            (local_t * std::f64::consts::PI).sin() * (dist_km / 2000.0).min(1.5)
        }
        _ => 0.0,
    };

    FrameCamera {
        frame,
        time: t,
        lat: lerp(from.lat, to.lat, et),
        lng: lerp_angle(from.lng, to.lng, et),
        zoom: lerp(from.zoom, to.zoom, et) - arc,
        pitch: lerp(from.pitch, to.pitch, et),
        bearing: lerp_angle(from.bearing, to.bearing, et),
    }
}

fn find_segment<'a>(kfs: &'a [Keyframe], t: f64) -> (&'a Keyframe, &'a Keyframe, f64) {
    // Clamp to range
    if t <= kfs[0].time {
        return (&kfs[0], &kfs[1], 0.0);
    }
    let last = kfs.len() - 1;
    if t >= kfs[last].time {
        return (&kfs[last - 1], &kfs[last], 1.0);
    }

    // Find the segment
    for i in 0..last {
        let from = &kfs[i];
        let to = &kfs[i + 1];
        if t >= from.time && t <= to.time {
            let seg_duration = to.time - from.time;
            let local_t = if seg_duration > 0.0 {
                (t - from.time) / seg_duration
            } else {
                0.0
            };
            return (from, to, local_t.clamp(0.0, 1.0));
        }
    }

    (&kfs[last - 1], &kfs[last], 1.0)
}

// ── Math helpers ──────────────────────────────────────────────────────────

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

fn lerp_angle(a: f64, b: f64, t: f64) -> f64 {
    let mut diff = b - a;
    // Shortest path around the circle
    if diff > 180.0 { diff -= 360.0; }
    if diff < -180.0 { diff += 360.0; }
    a + diff * t
}

fn apply_easing(t: f64, easing: &EasingType) -> f64 {
    match easing {
        EasingType::Linear => t,
        EasingType::EaseInOut => smoothstep(t),
        EasingType::CinematicArc => {
            // Slow start, fast middle, slow end — dramatic feel
            smoothstep(smoothstep(t))
        }
    }
}

fn smoothstep(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 6371.0;
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlon / 2.0).sin().powi(2);
    2.0 * R * a.sqrt().asin()
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_kfs() -> Vec<Keyframe> {
        vec![
            Keyframe {
                id: "1".into(), label: "Start".into(),
                time: 0.0, lat: 12.66, lng: 108.05,
                zoom: 5.0, pitch: 0.0, bearing: 0.0,
                easing: EasingType::EaseInOut,
            },
            Keyframe {
                id: "2".into(), label: "End".into(),
                time: 5.0, lat: 21.02, lng: 105.83,
                zoom: 12.0, pitch: 60.0, bearing: -20.0,
                easing: EasingType::EaseInOut,
            },
        ]
    }

    #[test]
    fn compute_returns_correct_count() {
        let frames = compute_frames(&sample_kfs(), 30);
        assert_eq!(frames.len(), 150); // 5s * 30fps
    }

    #[test]
    fn first_frame_matches_start() {
        let frames = compute_frames(&sample_kfs(), 30);
        let f = &frames[0];
        assert!((f.lat - 12.66).abs() < 0.01);
        assert!((f.zoom - 5.0).abs() < 0.01);
    }

    #[test]
    fn last_frame_matches_end() {
        let frames = compute_frames(&sample_kfs(), 30);
        let f = frames.last().unwrap();
        assert!((f.lat - 21.02).abs() < 0.1);
    }
}
