# Project evaluation plan

Status: **plan**. Nothing in this document is available in the app yet.

Owner request (21 October 2026): an informed evaluation of a project based on its
location (neighbourhood, city, country):

- construction cost per station or stop and per kilometre by structure (street level,
  elevated, underground) for each mode;
- operating cost per service line and expected fares;
- ridership per line and for the whole project;
- shorter trips, released parking area, and the shift away from car dependency;
- emissions, land value, wider economic impacts (growth, GDP) and citizens' quality of
  life.

## Ground rules (from CLAUDE.md)

- **Deterministic code computes every number.** No figure comes from a language model.
- **Every default is cited and carries a status** (`documented_default`, `user_override`,
  `calibrated`, `demonstration`) and, where sources disagree, a low–central–high range.
  An uncited value is labelled "placeholder".
- **Real places never show synthetic data.** When an input is missing, the app reports
  "input required" and names the input, instead of filling it in.
- **Wording:** results are "estimated under the selected assumptions". They are a
  sketch-level appraisal, not a business case, an EIA or an investment decision.

## Data sources checked

| Source | Licence / access (as read on 21 October 2026) | Use in the app |
| --- | --- | --- |
| **WorldPop** population grids | REST catalogue `worldpop.org/rest/data`; per-country 100 m GeoTIFF (people per cell), 2000–2020. The licence file linked from the API returned 404, so the licence is to be confirmed before use (the site asks for responsible, non-harmful use). | **Fallback population** for catchments where no region is drawn. A summed raster per polygon must be done in the backend (or a pre-clipped extract for the desktop app). |
| Meta high-resolution population (HDX) | The page refused automated access (HTTP 403); licence not verified. | Candidate second source; verify the licence manually. |
| GSMA Open Gateway / CAMARA Population Density Data | API spec Apache-2.0, but the data comes from mobile operators under agreements (4G/5G coverage only). | **Not usable** as a free public source. |
| Open-Elevation | Code GPL-2.0; public API free for 1,000 requests or 500 coordinates per month (250 m SRTM). | Too limited for line profiles; not recommended. |
| Elevation-API.eu | Free, 10 requests/s, no key; Copernicus DEM. No attribution text on the site. | **Candidate** for line and ramp profiles through a caching backend proxy; Copernicus attribution to be shown. |
| Mobility Database | API code Apache-2.0; catalogue metadata CC0; each feed under its owner's licence; API token required. | **Find existing GTFS feeds** for a city (current service, for comparison and as a base). |
| OpenStreetMap / Overpass | ODbL (already used). | Land use, buildings, parking areas, POIs, streets. |
| MobilityData GTFS Validator | Apache-2.0, Java 17 (CLI, Docker image, web UI; no browser version). | Check our GTFS export. See "GTFS validation" below. |
| GBFS (shared bikes/scooters) | Spec by MobilityData; catalogue `systems.csv` lists public feeds; each feed under its owner's terms, some need keys. | **Optional, later**: shared-mobility supply near stops as feeder context. Not needed for the core appraisal. |
| Transit Costs Project (NYU Marron) | Data page "© 2024 Marron Institute. All rights reserved."; official dataset on NYU UltraViolet (record unreachable at the time). Fields: length, tunnelled share, stations, PPP-adjusted cost, years. | **Cite, do not redistribute**: the app links to it and lets users enter comparable projects' figures. Ask the project for permission to ship derived ranges. |
| World Bank datasets and projects | Datasets CC BY 4.0 with attribution; the API terms forbid commercial use of the Materials through the APIs. | Project appraisal documents as cited references for cost ranges in developing economies; GDP and price levels (World Development Indicators) for currency and PPP conversion. |
| OC4IDS (Open Contracting for Infrastructure) | Standard Apache-2.0; it is a data format, not a cost dataset. | Optional export of a project in OC4IDS format; import of published OC4IDS project data where a city publishes it. |
| UNECE ITIO, ERA RINF, OECD/ITF statistics, US STB | Not reachable at the time (DNS errors, HTTP 403, script-only pages) or freight-only (STB). | To be checked again by hand; RINF for EU rail scoping, OECD/ITF for national investment context. |
| "EstimationPro" construction cost API | No trace found. | Not usable until a source is found. |
| US National Transit Database | Portal not reachable at the time; US federal data are generally public domain (to be confirmed). | **Cited operating-cost ranges** (cost per vehicle revenue hour/km by mode) for US cities. |

## Methods checked

| Method | Use in the app | Source |
| --- | --- | --- |
| **Cost-benefit analysis**: FNPV, FIRR, ENPV, ERR, social discount rate, reference period | **Yes**, the core of the appraisal. | EU *Guide to Cost-Benefit Analysis of Investment Projects* (2014) and *Economic Appraisal Vademecum 2021–2027*. The PDF failed to load and must be read again. UK TAG unit A1.1 (Open Government Licence v3.0, updated 28 May 2026). |
| Values of time, crowding, reliability | **Yes**, as country-specific inputs. UK values come from the TAG data book (OGL v3.0, v2.03), other countries from their own guidance. | TAG data book; national guides. |
| **Activity-based costing** of operations (vehicle-km, vehicle-hours, peak vehicles) and **life-cycle cost** (renewals over the asset lives) | **Yes**. The simulation already gives vehicle-km, hours and fleet per line. | Unit rates entered or cited per city (for example NTD). |
| External costs: accidents, noise, air pollution, climate | **Yes**, per car-km avoided and per vehicle-km added. | European Commission *Handbook on the External Costs of Transport* (2019). Not yet read. |
| **Life-cycle assessment** (construction and operation emissions) | **Simplified**: operation from the R15b energy estimate times a grid factor; construction from cited embodied-emission factors per km by structure. A full LCA (openLCA with commercial databases) is out of scope. | Factors to be sourced. |
| Health from active travel to stations | **Yes, simplified**, after the WHO HEAT method (walking to and from stops). | WHO HEAT. The method page was not readable; to be read. |
| **Hedonic pricing** (land value premium near stations) | **Indicative only**: apply published meta-analysis premiums by distance band to property values the user enters. No regression is run in the app. | Meta-analyses, for example Debrezion, Pels & Rietveld (2007). Not yet read. |
| **Wider economic impacts** (agglomeration, labour market) | **Indicative, labelled**: effective-density change from the travel-time matrix times cited agglomeration elasticities. | UK TAG A2.1 (OGL v3.0). |
| **Computable general equilibrium** (GDP, sectors) | **No**. It needs a national input–output model and is far beyond a sketch tool. The app states the investment and the wider impacts; the GDP effect is not modelled. | — |
| **Land-use/transport interaction** (TRANUS, MEPLAN, UrbanSim) | **No** dynamic model. Accessibility change per region is reported as the input such models need. | — |
| **Multi-criteria analysis** | **Yes**, for quality of life: user-weighted indicators (travel time saved, access to jobs, noise, released street space, step-free access, safety), with weights shown and editable. | — |
| **EIA / SEA** | **No** (regulatory processes). The app reports screening indicators: protected areas and water crossed (from OSM), and construction emissions. | — |

Stated-preference surveys (needed for a social cost-benefit analysis of intangibles) are
user inputs; the app does not invent willingness-to-pay values.

**Libraries:** none of the libraries checked can be bundled.

- TUBA (UK) is paid software.
- R5, OpenTripPlanner, UrbanSim, pandana and osmnx are server-side Java or Python, and some
  have share-alike licences. Their licences still need checking one by one.
- The calculations above are small enough to write in TypeScript in `analysis/`, citing the
  methods, as with SUMO, OSRD and NeTrainSim.

## Calculation chain (proposed)

1. **People and places**
   - **Inputs:** regions the user draws with population, jobs, land use and structure
     type. Where none are drawn: WorldPop population, plus OSM land use and buildings.
   - **Output:** population and jobs within each station catchment (walking distance along
     streets, or a radius as a fallback).
2. **Ridership**
   - Trips generated per catchment, from region statistics or cited trip rates.
   - Mode choice from the travel-time difference between car and transit, with cited
     elasticities, or a ridership model calibrated on an existing GTFS feed of the same
     city from the Mobility Database.
   - Reported per line, per station and for the whole project, as a low–central–high range.
3. **Operations**
   - Vehicle-km, vehicle-hours and peak fleet, from the simulation.
   - Operating cost per line by activity-based costing.
   - Energy and emissions, from R15b.
4. **Construction**
   - Quantities from the drawing: km by structure and mode, stations by type and level,
     ramps, turnouts and depots.
   - Each quantity times a unit-cost range from cited comparable projects, adjusted for
     price level and PPP.
   - Life-cycle renewals over the asset lives.
5. **Fares and revenue**
   - Fare scenarios entered by the user: flat, distance-based or zonal.
   - Revenue = ridership × fare, with a cited fare elasticity.
   - Break-even fare.
6. **Benefits**
   - Travel time saved (riders and remaining drivers).
   - Car-km avoided, with external costs (accidents, noise, air, climate) and parking
     spaces released (parking area within catchments from OSM × the shift).
   - Health from walking to stops.
7. **Appraisal**
   - FNPV and FIRR (operator view), ENPV, ERR and the benefit–cost ratio (society).
   - Discount rate and reference period from the selected guide (EU or UK), with a
     sensitivity table.
8. **Wider and social**
   - Indicative land-value uplift, indicative agglomeration benefit.
   - MCA score for quality of life.
   - A clear note that GDP and land-use change are not modelled.

## GTFS validation

The canonical MobilityData validator is Java (Apache-2.0). Proposal:

- the app runs its own fast checks on the GTFS export (required files, references, times
  increasing, shapes) in TypeScript;
- the GTFS export dialog links to the MobilityData web validator;
- an optional backend container (`ghcr.io/mobilitydata/gtfs-validator`) runs the full
  validator for self-hosted installations.

A full GTFS editor is not needed: the project itself is the editor and GTFS is an export.

## Proposed steps

| Step | Content |
| --- | --- |
| E1 | Region statistics (population, jobs, land use, structure type) on drawn regions; WorldPop fallback through the backend; catchments along streets |
| E2 | Ridership per line, station and project (ranges, cited elasticities; calibration on an existing GTFS feed) |
| E3 | Operating cost per line (activity-based), life-cycle cost; fares and revenue scenarios |
| E4 | Construction cost per element, mode and structure (cited ranges, price-level adjustment) |
| E5 | Benefits and appraisal: time savings, external costs, parking released, health; FNPV/FIRR, ENPV/ERR, BCR, sensitivity |
| E6 | Indicative wider impacts (agglomeration), land-value uplift, MCA for quality of life; GTFS checks and validator link |
