"""Provider instances for one application (created at start-up)."""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from ..config import Settings
from .arcgis_traffic import ArcGisTrafficProvider
from .base import TTLCache
from .camara_population import CamaraPopulationProvider
from .nominatim import NominatimProvider
from .overpass import OverpassProvider
from .transport_rest import TransportRestProvider
from .valhalla import ValhallaRoutingProvider


@dataclass
class Providers:
    overpass: OverpassProvider
    nominatim: NominatimProvider
    population: CamaraPopulationProvider
    traffic: ArcGisTrafficProvider
    transit: TransportRestProvider
    routing: ValhallaRoutingProvider

    def all(
        self,
    ) -> list[
        OverpassProvider
        | NominatimProvider
        | CamaraPopulationProvider
        | ArcGisTrafficProvider
        | TransportRestProvider
        | ValhallaRoutingProvider
    ]:
        return [self.overpass, self.nominatim, self.population, self.traffic, self.transit, self.routing]


def build_providers(settings: Settings, client: httpx.AsyncClient) -> Providers:
    return Providers(
        overpass=OverpassProvider(settings, client, TTLCache()),
        nominatim=NominatimProvider(settings, client, TTLCache()),
        population=CamaraPopulationProvider(settings, client),
        traffic=ArcGisTrafficProvider(settings),
        transit=TransportRestProvider(settings, client),
        routing=ValhallaRoutingProvider(settings, client, TTLCache()),
    )
