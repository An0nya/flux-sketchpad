# How the sketchpad arrives at a result

These are the mathematical derivations and engineering choices behind the program,
with the assumptions made explicit. The tests are executable counterparts, not a
substitute for reviewing these assumptions.

## 1. A mirror normal from two points

Let `i` be the unit direction travelling from source to facet, and `o` the desired
unit direction from facet to target. The reflection law is

```
o = i − 2(i · n)n
```

Rearranging shows `o − i` is parallel to the normal `n`. Therefore

```
n = normalize(o − i)
  = normalize(direction(facet → target) + direction(facet → source))
```

That is the bisector of the two directions *away from the facet*. Confusing the
incoming propagation direction with the outward source direction gives the wrong
bisector. `Design.aim` uses this sign convention. Its normal points towards the
source, establishing which mirror face reflects. The bisector test actually traces
the centre ray to an offset target and measures its positional miss.

## 2. Why a facet creates a tile, not a point

Use a transverse coordinate `x` and a mirror at axial coordinate zero. The source
is at distance `a` and the target at distance `b`, on the reflecting side. A ray
leaves source point `s` and strikes facet point `x`.

For a flat mirror, its outgoing transverse slope is `(x − s)/a`, so

```
y = x + b(x − s)/a
  = (1 + b/a)x − (b/a)s
```

The target patch is the combination of the facet's expanded footprint and the
inverted source image. In this simple geometry, the full support width is

```
W ≈ (1 + b/a) × facet_width + (b/a) × source_width
```

This is a width estimate, not a Gaussian blur kernel. Uniform rectangle emitters,
discs, volume emitters, and points produce different distributions because their
positions are actually sampled. Nothing blurs the raw accumulator afterwards.

For a locally concave paraboloid, slope of the surface is `x/(2f)`. Reflection
doubles the normal's angular change, giving the first-order outgoing slope
`(x − s)/a − x/f`. Thus

```
y ≈ (1 + b/a − b/f)x − (b/a)s
```

At the conjugate image plane, `1/f = 1/a + 1/b`, the coefficient of the aperture
coordinate vanishes. There the image magnification is

```
m = −b/a = −f/(a − f)
```

So a curved segment's focused image depends on focal length. At an arbitrary fixed
target plane, the explicit finite-source term is still `−(b/a)s`, and defocus
reintroduces the aperture term. These statements are compatible; using `b/a` as a
standalone universal curved-segment tile formula would not be.

`Design.makeFacet` chooses aperture and focal length from this first-order support
estimate. For a flat facet it must alter aperture to change width. For a curved
facet, it can retain intercepted aperture and alter focal length. This estimate
assumes small angles and a nearly normal chief ray. Off-axis sagittal/tangential
focusing differs; the scalar estimate does not solve that astigmatism.

## 3. Exact curved intersections

An analytic patch has a local orthonormal frame and surface

```
z = (x² + y²)/(4f)
```

Substitute a ray `p + td`. With `k = 1/(4f)`:

```
A = k(dx² + dy²)
B = 2k(px dx + py dy) − dz
C = k(px² + py²) − pz
A t² + B t + C = 0
```

The solver checks positive roots in distance order and rejects roots outside the
finite rectangle/disc. It uses a cancellation-resistant quadratic formula and a
linear case when `A` vanishes. The unnormalized local normal is the gradient

```
n_local = (−x/(2f), −y/(2f), 1)
```

The gradient is rotated into world coordinates and normalized. Reflection uses
this actual normal, not the centre normal or a thin-lens angular shortcut.

Mesh surfaces use finite triangle intersection. A tree of axis-aligned bounds
prunes impossible hits. The engine always chooses the nearest surface, or the
target if the target is nearer. Numerical ray-origin offsets scale with scene
length; the 10× invariance test guards against a hardcoded physical epsilon.

## 4. Placement without a spherical shell

Let source `S`, target `T`, their separation `D`, and direction `w` from the source
be given. Place a candidate at `P = S + r w`. A focusing surface has constant total
path length

```
|P − S| + |T − P| = L
```

Squaring `|T − S − r w| = L − r` and cancelling `r²` gives

```
r = (L² − D²) / (2(L − D cosθ))
```

Writing `L = D + 2f`, and letting the target become distant, gives

```
r → 2f / (1 − cosθ)
```

This is the polar equation of a paraboloid with the source at its focus. Radius
varies with direction. Sampling different `f` values lets candidates stretch into
deep or asymmetric enclosures. Each candidate is rejected unless its finite curved
boundary fits the envelope. Large facets are limited by actual room and optics,
not the width of a search-space bin.

Direction samples are distributed in approximately equal solid angle. A small
facet with projected area `A cosα` at distance `r` subtends approximately

```
Ω ≈ A cosα / r²
intercepted fraction ≈ angular_density(w) × Ω
```

This is the flux-ranking measure. It is approximate for nearby large facets and
finite emitters. The final tracer is the authority for real interception and
shadowing. Angular-footprint exclusion discourages assigning multiple surfaces to
the same source directions; exact intersections reveal any remaining occlusion.

Paint intensities are integrated over equal-area target cells, and weighted spatial
quantiles allocate more tiles to brighter regions. Each tile is a complete source
image, not a single painted accumulator cell. This is deliberately a constructive
heuristic, not an optimization certificate. Preserving a fitting incumbent during
envelope expansion repairs a finite search's measured interception regression.

## 5. Sampling the emitter

Every primary ray carries equal power `source_power / ray_count`.

- Rectangle positions: uniform local X and Y.
- Disc positions: `r = R√u`, `φ = 2πv`; the square root accounts for area.
- Sphere volume: radius `R∛u`, uniform polar cosine and azimuth.
- Cylinder volume: uniform disc and axial coordinate.
- Lambertian directions: `cosθ = √u`, uniform azimuth. This samples
  `p(ω) = cosθ/π` over the forward hemisphere.
- Uniform cone: `cosθ = 1 − u(1 − cosθ_max)`.
- Gaussian angular intensity: numerically invert the cumulative polar density
  `exp(−θ²/(2σ²)) sinθ`. The `sinθ` is essential: polar angle is not solid angle.

A local basis rotates positions and directions onto any 3D emission axis. Planar
emitters emit into their front hemisphere; volume emitters default to a full-sphere
uniform cone. The deterministic integer PRNG is independent of surface ordering.

## 6. Refraction, reflection, and energy

Let the incident direction be `d`, with `n` oriented against it, `cᵢ = −d·n`, and
`η = n₁/n₂`. Tangential wave matching (Snell's law) fixes the outgoing tangent;
unit length fixes its normal component:

```
k = 1 − η²(1 − cᵢ²)
d_transmitted = ηd + (ηcᵢ − √k)n
```

If `k < 0`, there is no real transmitted direction: total internal reflection.
Otherwise unpolarized Fresnel reflectance is

```
r_s = (n₁cᵢ − n₂cₜ)/(n₁cᵢ + n₂cₜ)
r_p = (n₂cᵢ − n₁cₜ)/(n₂cᵢ + n₁cₜ)
R = (r_s² + r_p²)/2
```

The engine follows reflected energy `R E` and transmitted energy `(1−R)E`. It does
not mislabel Fresnel reflection as absorption. A mirror instead absorbs `(1−ρ)E`
and reflects `ρE`; `ρ` and refractive index are separate surface properties.

Closed refractive meshes have outward normals. Dot product with that normal says
whether the ray is entering air→glass or leaving glass→air. This rule is correct
for isolated bodies in air; nested media require a material stack, not implemented.

The floor and bounce cap terminate branches into the explicitly reported unresolved
ledger. This preserves accounting while acknowledging incomplete propagation.

## 7. Lenses and the meaning of “preset”

Spherical plano/biconvex surfaces use the thin-lens formula as an authoring estimate
of radius, then are meshed as a closed finite-thickness body. Refraction is performed
at both actual boundaries, so the resulting focal position includes mesh error and
thick-lens effects. The default lens's placement offset is `max(thickness + 1,
0.35 × focal_length)` along the source axis; it is an illuminated lens demonstration,
not an assertion that the source is at the focal plane.

Fresnel geometry has annular slopes and explicit step walls. Increasing ring count
changes geometry. The present slope estimate is paraxial and is not an optimized
high-numerical-aperture Fresnel prescription.

The TIR cup has a recessed entrance, expanding outer wall, and planar exit. Rays
can undergo real total internal reflection, but its straight profile is not the
special aspheric prescription required for exact collimation. It is labelled
experimental in both the app and README.

## 8. What the tests do and do not establish

Laws and conservation tests exercise the primitive equations. Invariance tests
exercise their composition. The source-image test sends rays through real mirror
intersections at controlled source/aperture points, rather than fitting a rendered
blob. The collimation test uses the actual revolved triangle mesh, not an ideal
parabola formula pretending to be that mesh.

Control tests compare raw byte hashes, not screenshots. A changed hash establishes
that a control is wired; it does not establish that its effect is useful or that a
designer would accept the resulting beam. Browser pointer tests cover the layer
that numeric reducer tests cannot: event ordering and deferred work cancellation.

Performance numbers are measured on actual runs. Neither a passing fixture nor a
low runtime makes the heuristic globally optimal or its feasibility estimates exact.
