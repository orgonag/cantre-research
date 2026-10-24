"""Build deterministic per-subdivision main-track chains (spec section 5.3, Decision 2).

A *chain* is a maximal run of Main, Operational track segments inside one subdivision that is
unbroken by a branch or a free end. Chains carry the cumulative along-track distance ``s`` that
every later stage (anchors, intervals, assets, tiles) measures against, so the construction must
not depend on record order, vertex order or hash seeds.

The rule, in the order it is applied:

1. **Eligibility (Decision 2).** Only ``TRACKCLASS == "Main"`` and ``STATUS == "Operational"``
   segments are chained. All others are returned in ``unchained`` with an info audit line,
   ``NOT_CHAINED_CLASS`` (class is not Main) or ``NOT_OPERATIONAL`` (Main, but not operational).
2. **Grouping.** Eligible segments are grouped by ``sub_nid`` (``SUBDI1NID``; ``SUBDI2*`` is
   ignored in v1). A chain never crosses a subdivision boundary, so a diamond where two
   subdivisions cross leaves both lines continuous.
3. **Degree.** Within a group, a node's degree is the number of segment ends at that
   :data:`~cantre_pipeline.model.NodeKey` (a self-loop segment contributes two ends). Segments
   of other classes, other statuses and other subdivisions do not count, so a siding attached
   mid-chain does not break it.
4. **Breaks.** Nodes of degree other than 2 (free ends, branches, crossovers) break chains. A
   maximal path between two breaks is one chain; segments are removed as they are visited.
5. **Cycles.** Whatever is left has only degree-2 nodes, so each component is a cycle. It starts
   at its smallest ``NodeKey`` and leaves along the neighbour with the smaller ``NodeKey``
   (ties: smaller segment key, then smaller vertex tuple), is flagged ``cycle=True``, and gets a
   ``CHAIN_CYCLE`` info audit line. A loop that returns to a branch node (degree >= 3) is an
   ordinary open chain whose two ends are the same node, not a cycle.
6. **Orientation.** An open chain starts at its smaller end ``NodeKey`` (tuple comparison); when
   both ends are the same node the direction with the smaller vertex tuple wins. Segment vertex
   lists are reversed as needed and the first vertex of each following segment is dropped at a
   join, so the earlier segment's quantised vertex is kept. For a cycle, the closing vertex is
   forced equal to the first one.
7. **Distance.** ``s_m = cumulative_lengths_m(pts)`` over the *quantised* ``pts``. Segments that
   do not share a ``NodeKey`` are never joined, however close they are (no gap bridging).
8. **Junctions.** Every junction ``NodeKey`` maps to its ``TRAJUNCTYP``. A junction whose node is
   the endpoint of no segment of any class gets a ``JUNCTION_OFF_NETWORK`` info line (kept in
   the map, not dropped). When several junctions share a node, ``Diamond`` wins, otherwise the
   alphabetically first type.

Chain ids are content hashes of the sorted segment keys, so they survive re-ordering of the input
and change only when the chain's membership changes. Units: metres for ``s_m``; coordinates are
the quantised degrees of :mod:`cantre_pipeline.model`.
"""

import hashlib
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

from cantre_pipeline.audit import AuditReason, AuditRecord
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.geodesy import LatLon, cumulative_lengths_m
from cantre_pipeline.model import Network, NodeKey, Segment

__all__ = ["Chain", "ChainSet", "build_chains"]

_Step = tuple[Segment, bool]
"""A segment in a path and whether it is traversed against its stored direction."""

_End = tuple[str, int]
"""``(segment key, 0 for the start end / 1 for the end end)``."""


@dataclass(frozen=True)
class Chain:
    """One chain of consecutive segments of a single subdivision.

    ``pts`` are quantised ``LatLon`` vertices, ``s_m[i]`` the cumulative distance to ``pts[i]`` in
    metres, ``segment_keys`` the segments in chain order and ``segment_ranges[key] = (i0, i1)``
    the vertex range of that segment, ``i1`` inclusive (neighbouring segments share a vertex).
    """

    id: str
    sub_nid: str
    sub_name: str
    operators: tuple[str, ...]
    pts: tuple[LatLon, ...]
    s_m: tuple[float, ...]
    segment_keys: tuple[str, ...]
    segment_ranges: Mapping[str, tuple[int, int]]
    cycle: bool


@dataclass(frozen=True)
class ChainSet:
    """Result of :func:`build_chains`.

    ``chains`` are sorted by id, ``unchained`` by segment key. ``audit`` holds only the lines
    raised here (the network's own lines stay on :attr:`Network.audit`).
    """

    chains: tuple[Chain, ...]
    unchained: tuple[Segment, ...]
    node_junctions: Mapping[NodeKey, str]
    audit: tuple[AuditRecord, ...]


def _oriented_pts(step: _Step) -> tuple[LatLon, ...]:
    seg, rev = step
    return seg.pts[::-1] if rev else seg.pts


def _far_node(step: _Step) -> NodeKey:
    """Node at the end of ``step`` in its direction of travel."""
    seg, rev = step
    return seg.start_node if rev else seg.end_node


def _near_node(step: _Step) -> NodeKey:
    """Node at the start of ``step`` in its direction of travel."""
    seg, rev = step
    return seg.end_node if rev else seg.start_node


def _reversed_path(path: list[_Step]) -> list[_Step]:
    return [(seg, not rev) for seg, rev in reversed(path)]


def _assemble(
    path: list[_Step], *, close: bool
) -> tuple[tuple[LatLon, ...], dict[str, tuple[int, int]]]:
    """Join the oriented vertex lists, dropping the duplicate vertex at each join.

    The earlier segment's vertex is kept: two ends in one ``NodeKey`` (1e-7 deg) can still
    round to different microdegrees. With ``close`` the last vertex is forced to the first.
    """
    pts: list[LatLon] = []
    ranges: dict[str, tuple[int, int]] = {}
    for step in path:
        sp = _oriented_pts(step)
        i0 = max(len(pts) - 1, 0)
        pts.extend(sp if not pts else sp[1:])
        ranges[step[0].key] = (i0, len(pts) - 1)
    if close:
        pts[-1] = pts[0]  # cycle: an exact closure keeps pts[0] == pts[-1]
    return tuple(pts), ranges


def _make_chain(path: list[_Step], sub_nid: str, *, cycle: bool) -> Chain:
    """Orient ``path`` canonically (rule 6) and build the :class:`Chain`."""
    pts, ranges = _assemble(path, close=cycle)
    if not cycle:
        first, last = _near_node(path[0]), _far_node(path[-1])
        flip = first > last
        if first == last:  # a loop back to its own branch node: smaller vertex tuple wins
            rpath = _reversed_path(path)
            rpts, _ = _assemble(rpath, close=False)
            keys = tuple(s.key for s, _ in path)
            rkeys = tuple(s.key for s, _ in rpath)
            flip = (rpts, rkeys) < (pts, keys)
        if flip:
            path = _reversed_path(path)
            pts, ranges = _assemble(path, close=False)
    segs = [s for s, _ in path]
    keys = tuple(s.key for s in segs)
    digest = hashlib.sha256("\n".join(sorted(keys)).encode("utf-8")).hexdigest()
    return Chain(
        id="ch_" + digest[:16],
        sub_nid=sub_nid,
        sub_name=min(s.sub_name for s in segs),
        operators=tuple(sorted({s.operator_mk for s in segs})),
        pts=pts,
        s_m=tuple(cumulative_lengths_m(pts)),
        segment_keys=keys,
        segment_ranges=MappingProxyType(ranges),
        cycle=cycle,
    )


class _Group:
    """The eligible segments of one subdivision and the walking state over them."""

    def __init__(self, segs: list[Segment]) -> None:
        self.by_key = {s.key: s for s in segs}
        self.ends: dict[NodeKey, list[_End]] = defaultdict(list)
        for s in segs:
            self.ends[s.start_node].append((s.key, 0))
            self.ends[s.end_node].append((s.key, 1))
        for lst in self.ends.values():
            lst.sort()
        self.visited: set[str] = set()

    def step_from(self, end: _End) -> _Step:
        """The step that leaves its node through segment end ``end``."""
        key, which = end
        return (self.by_key[key], which == 1)  # leaving via the end end means reversed

    def walk(self, first: _End) -> list[_Step]:
        """Follow degree-2 nodes from ``first`` until a break or a revisited segment."""
        path: list[_Step] = []
        cur = self.step_from(first)
        while True:
            self.visited.add(cur[0].key)
            path.append(cur)
            far = _far_node(cur)
            here = (cur[0].key, 0 if cur[1] else 1)  # the end we arrived through
            ends = self.ends[far]
            if len(ends) != 2:  # break: free end, branch or crossover
                return path
            nxt = ends[1] if ends[0] == here else ends[0]
            if nxt[0] in self.visited:  # closed the cycle
                return path
            cur = self.step_from(nxt)

    def component_nodes(self, key: str) -> set[NodeKey]:
        """All nodes of the unvisited component containing segment ``key``."""
        nodes: set[NodeKey] = set()
        stack = [self.by_key[key].start_node]
        while stack:
            n = stack.pop()
            if n in nodes:
                continue
            nodes.add(n)
            for k, _ in self.ends[n]:
                s = self.by_key[k]
                stack.extend((s.start_node, s.end_node))
        return nodes


def _chains_of_group(sub_nid: str, segs: list[Segment]) -> tuple[list[Chain], list[AuditRecord]]:
    g = _Group(segs)
    chains: list[Chain] = []
    audit: list[AuditRecord] = []
    for node in sorted(n for n, e in g.ends.items() if len(e) != 2):  # rules 3-4
        for end in g.ends[node]:
            if end[0] not in g.visited:
                chains.append(_make_chain(g.walk(end), sub_nid, cycle=False))
    for key in sorted(g.by_key):  # rule 5: only degree-2 components remain
        if key in g.visited:
            continue
        start = min(g.component_nodes(key))

        def lead(end: _End, start: NodeKey = start) -> tuple[NodeKey, str, tuple[LatLon, ...]]:
            step = g.step_from(end)
            return (_far_node(step), end[0], _oriented_pts(step))

        first = min(g.ends[start], key=lead)
        chain = _make_chain(g.walk(first), sub_nid, cycle=True)
        chains.append(chain)
        audit.append(
            AuditRecord(
                "CHAIN",
                chain.id,
                "CHAIN_CYCLE",
                "info",
                f"{len(chain.segment_keys)} segments close on themselves in subdivision {sub_nid}",
            )
        )
    return chains, audit


def build_chains(net: Network, cfg: PipelineConfig) -> ChainSet:
    """Build the chains, unchained segments, junction labels and audit lines of ``net``.

    Implements the rule in the module docstring (spec section 5.3, Decision 2). The output is a
    pure function of the set of segments: record order, vertex direction and ``PYTHONHASHSEED``
    do not matter. ``cfg`` is accepted for interface uniformity; the rule has no threshold
    (node keys were already snapped by ``cfg.snap_deg`` during validation).

    Raises:
        ValueError: only through :func:`cumulative_lengths_m` if a vertex is out of range, which
            validated segments never are.
    """
    del cfg  # no thresholds here; the snap tolerance is applied when NodeKeys are made
    audit: list[AuditRecord] = []
    unchained: list[Segment] = []
    groups: dict[str, list[Segment]] = defaultdict(list)
    for s in sorted(net.segments, key=lambda x: x.key):
        if s.track_class != "Main":
            reason: AuditReason = "NOT_CHAINED_CLASS"
            detail = f"{s.key}: TRACKCLASS {s.track_class!r} is not chained"
        elif s.status != "Operational":
            reason = "NOT_OPERATIONAL"
            detail = f"{s.key}: Main track with STATUS {s.status!r} is not chained"
        else:
            groups[s.sub_nid].append(s)
            continue
        unchained.append(s)
        audit.append(AuditRecord("TRACK", s.nid, reason, "info", detail))

    chains: list[Chain] = []
    for sub_nid in sorted(groups):
        group_chains, group_audit = _chains_of_group(sub_nid, groups[sub_nid])
        chains.extend(group_chains)
        audit.extend(group_audit)
    chains.sort(key=lambda c: c.id)

    # Rule 8: junction label per node, and junctions on no segment endpoint of any class.
    on_network = {n for s in net.segments for n in (s.start_node, s.end_node)}
    types: dict[NodeKey, set[str]] = defaultdict(set)
    for j in net.junctions:
        types[j.node].add(j.attrs.get("TRAJUNCTYP", ""))
        if j.node not in on_network:
            audit.append(
                AuditRecord(
                    "JUNCTION",
                    j.nid,
                    "JUNCTION_OFF_NETWORK",
                    "info",
                    f"junction node {j.node} is the endpoint of no track segment",
                )
            )
    labels = {n: "Diamond" if "Diamond" in t else min(t) for n, t in types.items()}
    return ChainSet(
        chains=tuple(chains),
        unchained=tuple(unchained),
        node_junctions=MappingProxyType(labels),
        audit=tuple(audit),
    )
