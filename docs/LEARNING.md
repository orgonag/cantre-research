# Learning and building together — earlier working method

> [!NOTE]
> **Superseded on 2026-10-23.** The owner asked for CANTRE to be built to research
> grade and made release-ready instead of line by line. See [AGENTS.md](../AGENTS.md)
> and [the v1 spec](superpowers/specs/2026-10-23-cantre-v1-design.md). This page stays
> as the record of the method and lessons up to that date.

This is a research project and a way for the owner to learn math and coding with AI.

## One small step at a time

1. Agree the question for this session and explain the necessary algebra, geometry
   or programming idea in plain language. Link it to the research goal.
2. Work a small example by hand. State units, assumptions and expected results;
   distinguish what is measured, inferred, proposed or unknown.
3. Propose a small understandable code change. Discuss it and wait for the owner's
   direction before that substantive implementation step.
4. Build that agreed piece together. Explain every line, variable, calculation,
   condition and failure case; do not hide a large generated implementation behind
   a short summary. If the owner wants a different pace, agree it explicitly.
5. Run an appropriate small check, explain the output and inspect it together.
   Record surprising results and open hypotheses rather than quietly tuning them away.
6. Pause for discussion before the next substantive implementation step. Do not
   continue through the entire plan automatically or delegate an autonomous app build.

Documentation/checks explicitly requested by the owner can be completed normally.
This cadence is about substantive implementation, not asking permission for every
keystroke. Preserve an agreed small step's scope and do not turn it into a scaffold.

## Suggested learning sequence (not automatic execution)

| Topic | Small learning result |
| --- | --- |
| Coordinates, units and vectors | Explain subtraction, dot products and the synthetic projection example. |
| Projection and clamping | Implement one tiny function only after discussion; test an interior point, endpoint and zero-length segment. |
| Curves and path length | Sum an asymmetric polyline and distinguish its length from the endpoint chord. |
| Anchors and mileposts | Interpolate increasing/decreasing labels; explain missing brackets and why calibration is not truth. |
| Source data | Read one public feature, its metadata and licence; trace one deterministic transformation. |
| Matching ambiguity | Compare two synthetic routes at a diamond; model explicit choice and a visible lock. |
| GPS lifecycle | Understand timestamps, accuracy, permission and stale fixes before displaying a current result. |
| Browser interface | Add one understandable UI behavior around an already understood calculation. |
| Storage and delivery | Trace manifest → regional bundle → local matching; discuss privacy and offline boundaries. |
| Validation | Design held-out and independent-control experiments before interpreting any accuracy metric. |

Use docs/PROJECTION.md for the first worked example and docs/ACCEPTANCE.md for
future tests. A test specification is not evidence that the feature exists. Keep
research notes readable enough that the owner can explain the calculation back.

## Saved lessons

- [October 20, 2026 — Projection, anchors and track choice](lessons/2026-10-20-projection/README.md), with horizontal and diagonal diagrams and worked arithmetic. Next: translate the calculation into a small function together; no implementation yet.
