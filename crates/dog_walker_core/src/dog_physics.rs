pub fn step_leash_constraint(
    dog_x: &mut f64,
    dog_y: &mut f64,
    dog_vx: &mut f64,
    dog_vy: &mut f64,
    owner_x: f64,
    owner_y: f64,
    max_length: f64,
    stiffness: f64,
    damping: f64,
    dt: f64,
) -> bool {
    let dx = *dog_x - owner_x;
    let dy = *dog_y - owner_y;
    let dist = dx.hypot(dy);

    if dist > max_length && dist > 1e-6 {
        let excess = dist - max_length;
        let nx = dx / dist;
        let ny = dy / dist;

        // Spring force pulling dog toward owner
        let spring_force = excess * stiffness;
        *dog_vx -= nx * spring_force * dt;
        *dog_vy -= ny * spring_force * dt;

        // Radial velocity damping
        let radial_v = *dog_vx * nx + *dog_vy * ny;
        if radial_v > 0.0 {
            *dog_vx -= nx * radial_v * damping * dt;
            *dog_vy -= ny * radial_v * damping * dt;
        }

        // Hard distance clamping if overextended by > 40px
        if excess > 40.0 {
            *dog_x = owner_x + nx * (max_length + 40.0);
            *dog_y = owner_y + ny * (max_length + 40.0);
        }
        true
    } else {
        false
    }
}

pub fn step_ear_springs(
    left_angle: &mut f64,
    left_v: &mut f64,
    right_angle: &mut f64,
    right_v: &mut f64,
    dog_vx: f64,
    dog_vy: f64,
    dog_angle: f64,
    dt: f64,
) {
    let spring_k = 180.0;
    let damping = 14.0;

    let forward_speed = dog_vx * dog_angle.cos() + dog_vy * dog_angle.sin();
    let target_offset = (forward_speed * 0.003).clamp(-0.4, 0.4);

    let left_force = -spring_k * (*left_angle - target_offset) - damping * *left_v;
    *left_v += left_force * dt;
    *left_angle += *left_v * dt;

    let right_force = -spring_k * (*right_angle - target_offset) - damping * *right_v;
    *right_v += right_force * dt;
    *right_angle += *right_v * dt;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_leash_spring_constraint_pull() {
        let mut dog_x = 200.0;
        let mut dog_y = 100.0;
        let mut dog_vx = 50.0;
        let mut dog_vy = 0.0;
        let owner_x = 50.0;
        let owner_y = 100.0;
        let max_len = 100.0; // distance is 150 > 100
        let constrained = step_leash_constraint(
            &mut dog_x, &mut dog_y, &mut dog_vx, &mut dog_vy,
            owner_x, owner_y, max_len, 4.0, 5.0, 0.016,
        );
        assert!(constrained);
        assert!(dog_vx < 50.0); // Velocity directed toward owner
        assert!(dog_x <= 190.0); // Clamped within max_len + 40.0
    }

    #[test]
    fn test_leash_inactive_when_slack() {
        let mut dog_x = 80.0;
        let mut dog_y = 100.0;
        let mut dog_vx = 10.0;
        let mut dog_vy = 0.0;
        let owner_x = 50.0;
        let owner_y = 100.0;
        let max_len = 100.0; // distance 30 < 100
        let constrained = step_leash_constraint(
            &mut dog_x, &mut dog_y, &mut dog_vx, &mut dog_vy,
            owner_x, owner_y, max_len, 4.0, 5.0, 0.016,
        );
        assert!(!constrained);
        assert_eq!(dog_vx, 10.0);
    }

    #[test]
    fn test_leash_hard_clamp_when_severely_overextended() {
        let mut dog_x = 300.0;
        let mut dog_y = 100.0;
        let mut dog_vx = 100.0;
        let mut dog_vy = 0.0;
        let owner_x = 50.0;
        let owner_y = 100.0;
        let max_len = 100.0; // dist 250 > max_len + 40 (140)
        let constrained = step_leash_constraint(
            &mut dog_x, &mut dog_y, &mut dog_vx, &mut dog_vy,
            owner_x, owner_y, max_len, 4.0, 5.0, 0.016,
        );
        assert!(constrained);
        assert_eq!(dog_x, 190.0); // 50 + 140
    }

    #[test]
    fn test_ear_spring_damping() {
        let mut l_ang = 0.5;
        let mut l_v = 0.0;
        let mut r_ang = -0.5;
        let mut r_v = 0.0;
        for _ in 0..60 {
            step_ear_springs(&mut l_ang, &mut l_v, &mut r_ang, &mut r_v, 0.0, 0.0, 0.0, 1.0 / 60.0);
        }
        assert!(l_ang.abs() < 0.1);
        assert!(r_ang.abs() < 0.1);
    }
}
