# Learning the projection math

This is an independently written synthetic example, not railway coordinates or a
new accuracy result. Prerequisites: coordinate pairs, subtraction, multiplication,
division, fractions and the Pythagorean theorem. A vector is a displacement such
as “six metres east, eight metres north.” A dot product multiplies corresponding
components and adds them: `(x,y) dot (u,v) = xu + yv`. No calculus is needed for this
piecewise-linear method. Trigonometry enters when converting geographic coordinates
or calculating spherical distances.

## One segment, step by step

In a local metre coordinate system let the track segment run from A=(0,0) to
B=(6,8), and let the observed position be P=(6,2).

1. Direction vector D=B-A=(6,8); offset V=P-A=(6,2).
2. Squared segment length: `dot(D,D)=6*6+8*8=100`; length is 10 m.
3. Unbounded projection fraction:
   `t_raw = dot(P-A,B-A) / dot(B-A,B-A) = (6*6+2*8)/100 = 0.52`.
4. Clamp to the actual segment: `t=max(0,min(1,t_raw))=0.52`.
5. Projected point: `Q=A+t*(B-A)=(3.12,4.16)`.
6. Distance along this straight segment is `t*10=5.2 m`. The residual is
   `P-Q=(2.88,-2.16)`, whose length is `sqrt(2.88^2+2.16^2)=3.6 m`.

The dot product finds how far the position lies in the segment's direction.
The residual is perpendicular for an interior projection: `(P-Q) dot D=0`.
It is a geometric residual, not a statement about GPS precision or survey accuracy.

For P=(12,16), `t_raw=2` and clamping gives t=1 and Q=B. For P=(-3,-4),
`t_raw=-0.5`, so t=0 and Q=A. Without clamping we would project onto an infinite
line and invent a point beyond the represented segment.

If A=B, `dot(D,D)=0`: do not divide by zero. Treat that pair as a point candidate
Q=A (or skip the duplicate in a documented normalization step); it contributes
zero along-track length. A whole path of zero length cannot support interpolation.
Reject nonfinite coordinates. A near-zero-length policy must be explicit about units
and numerical representation rather than silently discarding short real segments.

## Geographic coordinates are not metre coordinates

Do not apply the worked metre example directly to raw latitude/longitude degrees.
For a small area, a local approximation around (lon0,lat0) is
`x=R*cos(lat0)*(lon-lon0)` and `y=R*(lat-lat0)`, with angles in radians and R in metres.
This approximately accounts for longitude degrees becoming shorter toward the poles.
It has limits over large areas, near poles and across longitude wrapping.

The inspected original uses cos(latitude of the fix) to scale longitude differences
for the projection fraction, interpolates longitude/latitude to obtain Q, and uses
haversine distances for vertex lengths and residuals. This is an approximation,
not an exact projection onto an ellipsoidal geodesic. The future core must document
its coordinate system, datum treatment, region limits and numerical tolerances.
A local coordinate approximation does not itself transform NAD83 into a GPS datum.

## From one segment to a bending track

Evaluate consecutive vertex pairs, choose the closest plausible projection within
a candidate track, and sum preceding segment lengths plus the partial final segment.
Track selection is a separate inference problem; nearest projection alone can fail
at diamonds or nearby railways.

Example bending path A=(0,0), B=(30,0), C=(30,40) has length 30+40=70 m.
For P=(33,10), the closest projection is Q=(30,10) on B-C, 40 m along the path.
With calibrated MPs 100 at A and 100.07 at C:

`MP = 100 + (40/70)*(100.07-100) = 100.04`.

The A-C chord is 50 m, but the path follows the 70 m bend. With decreasing labels
100.07 at A and 100 at C, the same point receives MP 100.03. These invented anchor
labels illustrate scaling; they do not assert 70 metres equals 0.07 physical miles.

In the public pilot the bounding endpoints are adjacent qualified crossing anchors.
Clip the path at their projections while retaining every intervening vertex, then
use `MP_left + (along_distance/interval_path_length)*(MP_right-MP_left)`.
No bracket means no calculated milepost. Sparse geometry approximates real curves
with chords; subdividing an existing straight chord adds no missing curvature.

## Learning checks

Calculate the before/after-endpoint examples above, then move P around the bend.
Explain separately: which route is plausible, where Q lies on that route, and how
its path fraction maps to a milepost. Choosing a route does not make P more precise.
See [selection policy](IMPLEMENTATION.md#route-selection-and-user-control) and
[acceptance cases](ACCEPTANCE.md) for the ambiguity that arithmetic cannot resolve.
