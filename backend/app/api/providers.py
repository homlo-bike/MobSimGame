from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..logging_config import get_logger
from ..providers.base import ProviderError
from ..providers.networks import CITIES
from ..providers.overpass import traffic_signals_along
from ..providers.registry import Providers
from ..security import RateLimiter, client_key
from .deps import get_provider_limiter, get_providers

router = APIRouter(prefix="/api/v1", tags=["providers"])
log = get_logger(__name__)


def _limit(request: Request, limiter: RateLimiter) -> None:
    if not limiter.allow(client_key(request)):
        raise HTTPException(status_code=429, detail="Provider rate limit reached", headers={"Retry-After": "60"})


def provider_error_response(e: ProviderError) -> JSONResponse:
    log.warning(
        "provider request not served", extra={"state": e.state.value, "status": e.status_code, "reason": str(e)}
    )
    return JSONResponse(
        {"detail": str(e), "capability": {"state": e.state.value, "message": str(e)}},
        status_code=e.status_code,
    )


@router.get("/providers")
def list_providers(providers: Annotated[Providers, Depends(get_providers)]) -> dict[str, object]:
    """Capabilities of every backend provider. Never includes credentials."""
    return {
        "providers": [
            {
                "id": p.id,
                "kind": p.kind,
                "label": p.label,
                "sendsProjectDataToThirdParty": p.sends_project_data_to_third_party,
                "capability": p.capability().model_dump(),
            }
            for p in providers.all()
        ]
    }


@router.get("/osm/features-near", response_model=None)
async def osm_features_near(
    request: Request,
    providers: Annotated[Providers, Depends(get_providers)],
    limiter: Annotated[RateLimiter, Depends(get_provider_limiter)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    lat: Annotated[float, Query(ge=-90, le=90)],
    radius_m: Annotated[int, Query(ge=10, le=5000)] = 500,
) -> dict[str, object] | JSONResponse:
    _limit(request, limiter)
    try:
        res = await providers.overpass.features_near(lon, lat, radius_m)
    except ProviderError as e:
        return provider_error_response(e)
    return res.model_dump()


@router.get("/osm/features", response_model=None)
async def osm_features_bbox(
    request: Request,
    providers: Annotated[Providers, Depends(get_providers)],
    limiter: Annotated[RateLimiter, Depends(get_provider_limiter)],
    bbox: Annotated[str, Query(description="west,south,east,north in WGS84", max_length=120)],
    categories: Annotated[str, Query(max_length=300)],
) -> dict[str, object] | JSONResponse:
    _limit(request, limiter)
    try:
        w, s, e, n = (float(x) for x in bbox.split(","))
    except ValueError:
        raise HTTPException(status_code=400, detail="bbox must be west,south,east,north") from None
    try:
        res = await providers.overpass.features_in_bbox(w, s, e, n, [c for c in categories.split(",") if c])
    except ProviderError as err:
        return provider_error_response(err)
    return res.model_dump()


@router.get("/geocode", response_model=None)
async def geocode(
    request: Request,
    providers: Annotated[Providers, Depends(get_providers)],
    limiter: Annotated[RateLimiter, Depends(get_provider_limiter)],
    q: Annotated[str, Query(min_length=2, max_length=200)],
    places: bool = False,
) -> dict[str, object] | JSONResponse:
    _limit(request, limiter)
    try:
        res = await providers.nominatim.search(q, places_only=places)
    except ProviderError as e:
        return provider_error_response(e)
    return res.model_dump()


@router.get("/geocode/boundary/{osm_type}/{osm_id}", response_model=None)
async def geocode_boundary(
    request: Request,
    providers: Annotated[Providers, Depends(get_providers)],
    limiter: Annotated[RateLimiter, Depends(get_provider_limiter)],
    osm_type: Literal["node", "way", "relation"],
    osm_id: Annotated[int, Path(gt=0)],
) -> dict[str, object] | JSONResponse:
    _limit(request, limiter)
    try:
        res = await providers.nominatim.boundary(osm_type, osm_id)
    except ProviderError as e:
        return provider_error_response(e)
    return res.model_dump()


@router.get("/transit/stops-near", response_model=None)
async def transit_stops_near(
    request: Request,
    providers: Annotated[Providers, Depends(get_providers)],
    limiter: Annotated[RateLimiter, Depends(get_provider_limiter)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    lat: Annotated[float, Query(ge=-90, le=90)],
) -> dict[str, object] | JSONResponse:
    _limit(request, limiter)
    try:
        res = await providers.transit.stops_near(lon, lat)
    except ProviderError as e:
        return provider_error_response(e)
    return res.model_dump()


class RouteRequest(BaseModel):
    waypoints: list[tuple[float, float]] = Field(min_length=2, max_length=200)
    mode: Literal["bus", "brt", "trolleybus"] = "bus"
    #: True for one-way stop lines: approach each stop with it on the vehicle's side of the street.
    kerbside: bool = False


@router.post("/routing/route", response_model=None)
async def route(
    body: RouteRequest,
    request: Request,
    providers: Annotated[Providers, Depends(get_providers)],
    limiter: Annotated[RateLimiter, Depends(get_provider_limiter)],
) -> dict[str, object] | JSONResponse:
    """Route each leg between consecutive [lon, lat] waypoints on the street network."""
    _limit(request, limiter)
    for lon, lat in body.waypoints:
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise HTTPException(status_code=422, detail="Waypoints must be [longitude, latitude] in WGS84")
    try:
        res = await providers.routing.route_legs(list(body.waypoints), kerbside=body.kerbside)
    except ProviderError as e:
        return provider_error_response(e)
    return res.model_dump()


class SignalsRequest(BaseModel):
    paths: list[list[tuple[float, float]]] = Field(min_length=1, max_length=2000)
    radius_m: int = Field(default=15, ge=1, le=50)


#: Upper bound of coordinates per request, to keep Overpass queries reasonable.
MAX_SIGNAL_PATH_POINTS = 20000


@router.post("/osm/traffic-signals", response_model=None)
async def traffic_signals(
    body: SignalsRequest,
    request: Request,
    providers: Annotated[Providers, Depends(get_providers)],
    limiter: Annotated[RateLimiter, Depends(get_provider_limiter)],
) -> dict[str, object] | JSONResponse:
    """Road traffic signals along tram and bus lines ([lon, lat] paths), from OpenStreetMap."""
    _limit(request, limiter)
    points = sum(len(p) for p in body.paths)
    if points > MAX_SIGNAL_PATH_POINTS or any(len(p) < 2 for p in body.paths):
        raise HTTPException(status_code=422, detail=f"Send 2 to {MAX_SIGNAL_PATH_POINTS} points per request")
    for path in body.paths:
        for lon, lat in path:
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise HTTPException(status_code=422, detail="Coordinates must be [longitude, latitude] in WGS84")
    try:
        res = await traffic_signals_along(providers.overpass, [list(p) for p in body.paths], body.radius_m)
    except ProviderError as e:
        return provider_error_response(e)
    return res.model_dump()


@router.get("/examples")
def list_examples() -> dict[str, object]:
    """Cities and networks that can be loaded as examples from OpenStreetMap."""
    return {
        "cities": [
            {
                "id": c.id,
                "name": c.name,
                "country": c.country,
                "center": c.center,
                "zoom": c.zoom,
                "networks": [{"kind": n.kind, "label": n.label, "note": n.note} for n in c.networks],
            }
            for c in CITIES.values()
        ]
    }


@router.get("/examples/{city}/{kind}", response_model=None)
async def load_example(
    city: str,
    kind: str,
    request: Request,
    providers: Annotated[Providers, Depends(get_providers)],
    limiter: Annotated[RateLimiter, Depends(get_provider_limiter)],
) -> dict[str, object] | JSONResponse:
    """One city's tram, metro or bus network, loaded live from OpenStreetMap (cached)."""
    _limit(request, limiter)
    try:
        res = await providers.networks.load(city[:40], kind[:20])
    except ProviderError as e:
        return provider_error_response(e)
    return res.model_dump()


@router.get("/traffic/capability")
def traffic_capability(providers: Annotated[Providers, Depends(get_providers)]) -> dict[str, object]:
    return providers.traffic.capability().model_dump()
