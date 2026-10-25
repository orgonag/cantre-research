# Coverage report: SK

Dataset version: `nrwn-2.0+cantre.0.1.0`

Source `sk` SHA-256: `0000000000000000000000000000000000000000000000000000000000000000`
Source `tc-gci` SHA-256: `1111111111111111111111111111111111111111111111111111111111111111`

**Internal coverage, not surveyed accuracy.** A calibrated interval means published mileposts bracket the position; it does not mean the interpolated value was compared with a survey.

| Subdivision | Operators | Chain km | Calibrated km | Calibrated % | Posted-only km | Anchors posted / tc / unverified | Rejected |
|---|---|---:|---:|---:|---:|---|---:|
| Alpha | CN | 13.705 | 13.020 | 95.000 | 13.020 | 4 / 1 / 2 | 13 |
| Beta | CN | 8.168 | 6.126 | 75.000 | 6.126 | 5 / 0 / 0 | 0 |
| Delta | CN | 5.396 | 4.047 | 75.000 | 4.047 | 4 / 0 / 0 | 0 |
| Epsilon | CN | 12.278 | 5.371 | 43.745 | 5.371 | 4 / 0 / 0 | 0 |
| Eta | CN | 8.442 | 0.000 | 0.000 | 0.000 | 1 / 0 / 0 | 0 |
| Gamma | CN | 6.776 | 6.098 | 90.000 | 6.098 | 3 / 0 / 0 | 0 |
| Iota | CN | 6.589 | 5.930 | 90.000 | 0.000 | 1 / 1 / 0 | 0 |
| Kappa | CN | 5.902 | 3.935 | 66.667 | 2.951 | 1 / 0 / 1 | 2 |
| Theta A | CN | 3.310 | 2.648 | 80.000 | 2.648 | 2 / 0 / 0 | 0 |
| Theta B | CN | 3.310 | 2.648 | 80.000 | 2.648 | 2 / 0 / 0 | 0 |
| Zeta | CN | 13.365 | 9.356 | 70.000 | 9.356 | 4 / 0 / 0 | 0 |
| **Total** | CN | 87.240 | 59.178 | 67.833 | 52.264 | 31 / 2 / 3 | 16 |

Chain cycles: 1. Subdivisions with 0 % calibration: 1.

## Audit lines by reason

| Reason | Rejected | Info |
|---|---:|---:|
| ANCHOR_CONFLICT | 2 | 0 |
| ANCHOR_MERGED | 0 | 2 |
| ANCHOR_OUTLIER | 2 | 0 |
| ASSET_UNPOSITIONED | 0 | 3 |
| CHAIN_CYCLE | 0 | 1 |
| MILEAGE_SENTINEL | 3 | 0 |
| NOT_CHAINED_CLASS | 0 | 1 |
| NOT_POSTED | 1 | 0 |
| POSTED_SENTINEL | 1 | 0 |
| RESIDUAL_TOO_LARGE | 1 | 0 |
| SOURCE_DISAGREEMENT | 1 | 0 |
| SUBDIVISION_MISMATCH | 1 | 0 |
| TC_DUPLICATE_NUMBER | 0 | 1 |
| TC_SPUR_CROSSING | 1 | 0 |
| TRACK_NOT_CHAINED | 1 | 0 |
| UNVERIFIED_DEVIATION | 2 | 0 |
