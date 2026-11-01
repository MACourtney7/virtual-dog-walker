pub fn lerp_angle(a: f64, b: f64, t: f64) -> f64 {
    let mut diff = b - a;
    while diff > std::f64::consts::PI {
        diff -= 2.0 * std::f64::consts::PI;
    }
    while diff < -std::f64::consts::PI {
        diff += 2.0 * std::f64::consts::PI;
    }
    a + diff * t
}

pub struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6D2B79F5);
        let mut z = self.state;
        z = (z ^ (z >> 15)).wrapping_mul(z | 1);
        z ^= z.wrapping_add((z ^ (z >> 7)).wrapping_mul(z | 61));
        let val = (z ^ (z >> 14)) >> 0;
        (val as f64) / 4294967296.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lerp_angle_shortest_path() {
        use std::f64::consts::PI;
        let a = PI * 0.9;
        let b = -PI * 0.9;
        let mid = lerp_angle(a, b, 0.5);
        // Shortest path goes through PI / -PI
        assert!((mid.abs() - PI).abs() < 1e-4);
    }

    #[test]
    fn test_mulberry32_deterministic() {
        let mut rng1 = Mulberry32::new(12345);
        let mut rng2 = Mulberry32::new(12345);
        for _ in 0..10 {
            let v1 = rng1.next_f64();
            let v2 = rng2.next_f64();
            assert_eq!(v1, v2);
            assert!(v1 >= 0.0 && v1 < 1.0);
        }
    }
}

