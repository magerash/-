"""Synthetic checks for the geometric core of build_site (run: python -m pytest pipeline/test_build_site.py, or python it)."""
import math

import numpy as np

from build_site import dominant_angle, find_side, fit_plane_robust, rot_to_quat, rotation_to_y


def test_rotation_to_y():
    for up in ([0.1, 0.9, 0.2], [0, -1, 0.01], [1, 0, 0]):
        up = np.array(up, float) / np.linalg.norm(up)
        R = rotation_to_y(up)
        assert np.allclose(R @ up, [0, 1, 0], atol=1e-9)
        assert abs(np.linalg.det(R) - 1) < 1e-9


def test_quaternion_roundtrip():
    rng = np.random.default_rng(1)
    for _ in range(20):
        q = rng.normal(size=4); q /= np.linalg.norm(q)
        x, y, z, w = q
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        q2 = rot_to_quat(R)
        assert min(np.abs(q2 - q).max(), np.abs(q2 + q).max()) < 1e-9


def synthetic_fence(W=48.5, D=50.0, ang=17.0, unit=3.0, n=4000, seed=0):
    rng = np.random.default_rng(seed)
    pts = []
    for (a, b) in [((0, 0), (W, 0)), ((W, 0), (W, D)), ((W, D), (0, D)), ((0, D), (0, 0))]:
        t = rng.random(n)
        p = np.outer(1 - t, a) + np.outer(t, b) + rng.normal(0, 0.05, (n, 2))
        pts.append(p)
    clutter = rng.random((3000, 2)) * [W, D]
    outside = rng.random((2000, 2)) * [W + 30, D + 30] - 15
    outside = outside[(outside[:, 0] < -6) | (outside[:, 0] > W + 6) | (outside[:, 1] < -6) | (outside[:, 1] > D + 6)]
    P = np.vstack(pts + [clutter, outside])
    cams = np.c_[np.r_[np.linspace(2, W - 2, 50), np.full(50, W - 2), np.linspace(W - 2, 2, 50), np.full(50, 2)],
                 np.r_[np.full(50, 2), np.linspace(2, D - 2, 50), np.full(50, D - 2), np.linspace(D - 2, 2, 50)]]
    a = math.radians(ang)
    R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    return (P @ R.T) * unit, (cams @ R.T) * unit


def test_fence_lines_recovered():
    unit = 3.0
    P, C = synthetic_fence(unit=unit)
    ang, _ = dominant_angle(P, float(np.ptp(C, axis=0).max()))
    assert abs(ang - 17.0) < 0.6
    a = math.radians(ang)
    ax = {"+a": np.array([math.cos(a), math.sin(a)]), "+b": np.array([-math.sin(a), math.cos(a)])}
    ax["-a"], ax["-b"] = -ax["+a"], -ax["+b"]
    off = {}
    for k, d in ax.items():
        along = ax["+b"] if k[1] == "a" else ax["+a"]
        s = find_side(P, d, along, float((C @ d).max()), unit)
        assert s is not None, k
        off[k] = s["offset"]
    W = (off["+a"] + off["-a"]) / unit
    D = (off["+b"] + off["-b"]) / unit
    assert abs(W - 48.5) < 0.2, W
    assert abs(D - 50.0) < 0.2, D


def test_plane_fit_robust():
    rng = np.random.default_rng(2)
    xz = rng.random((500, 2)) * 50
    y = 1.0 + 0.01 * xz[:, 0] - 0.02 * xz[:, 1] + rng.normal(0, 0.03, 500)
    y[:40] += 1.5  # crouching / raised phone outliers
    coef, res = fit_plane_robust(xz, y)
    assert abs(coef[1] - 0.01) < 0.002 and abs(coef[2] + 0.02) < 0.002


if __name__ == "__main__":
    for name, f in list(globals().items()):
        if name.startswith("test_"):
            f()
            print("ok", name)
