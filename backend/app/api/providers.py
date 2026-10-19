from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from ..logging_config import get_logger
from ..providers.base import ProviderError
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
) -> dict[str, object] | JSONResponse:
    _limit(request, limiter)
    try:
        res = await providers.nominatim.search(q)
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


@router.get("/traffic/capability")
def traffic_capability(providers: Annotated[Providers, Depends(get_providers)]) -> dict[str, object]:
    return providers.traffic.capability().model_dump()
