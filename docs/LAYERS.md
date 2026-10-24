# Additional public layers — evidence and proposed audits

The [official NRWN catalogue](https://open.canada.ca/data/dataset/ac26807e-a1e8-49fa-87bf-451175a859b8)
describes Track Segment, Railway Crossing, Railway Station, Marker Post, Junction and
Railway Structure layers. The related [CanVec 50K transport schema](https://download-telecharger.services.geo.ca/pub/nrcan_rncan/vector/canvec/doc/CanVec_Catalogue_50K_Transport/SRDB_EXPL_ESSIM_50K_Transport-sd-en.html)
(version 1.0.3, dated 2018-02-05) documents structures including bridge, tunnel, culvert
and snowshed; junction descriptors including diamond, switch and end; crossing type,
level, warning system and Transport Canada ID; ownership/operator, subdivision,
classification, operating status and source/date metadata.

Schema availability is not proof of population, completeness, current status or
regional accuracy. The CanVec representation is not automatically identical to the
pilot GML schema; map fields and definitions explicitly before applying them. Do not
interpret the pilot accuracy value `10` from a differently named schema field.

**Proposed next audits, not implemented layers:** crossings, structures and junctions.
In a bounded corridor, enumerate actual records, missing fields, IDs, join coverage,
duplicates, native mileage and feature vintage. Validate the meaning of diamond/switch
connectivity rather than deriving a traversable connection from a geometric crossing.
Show unknown and dated status honestly; a missing record is not evidence of no asset.

**Optional future context, not committed scope:** terrain elevation/LiDAR and CanVec
hydrography. See [NRCan elevation information](https://natural-resources.canada.ca/science-data/data-analysis/geospatial-data-tools-services/elevation-data)
and the [CanVec hydrographic collection](https://open.canada.ca/data/en/dataset/9d96e8c9-22fe-4ad2-b5e8-94a6991b744b).
Check actual coverage, resolution, vertical datum, licence and vintage before proposing
use. Bare ground is not necessarily railhead height, especially on bridges or in
structures. These layers do not promise engineering grade, rail gradient accuracy or
improved milepost accuracy. Adding landscape context requires a separate discussed
learning step and supporting evidence.
