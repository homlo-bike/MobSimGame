"""ArcGIS Traffic service adapter (disabled).

The documented service (https://developers.arcgis.com/rest/routing/traffic-service/)
is a dynamic MapServer at traffic.arcgis.com with speeds updated every five
minutes. Its authentication, billing/credits, caching and redistribution terms
were NOT verified from that page, so this adapter performs no requests in
Phase 1. It reports `not_configured` without a token and
`manual_input_required` with one, until a maintainer verifies the terms and
implements the proxy (docs/PROVIDER_CONFIGURATION.md, "Traffic").
"""

from __future__ import annotations

from ..config import Settings
from .base import Capability, CapabilityState


class ArcGisTrafficProvider:
    id = "arcgis-traffic"
    kind = "traffic"
    label = "ArcGIS Traffic (live/predicted)"
    sends_project_data_to_third_party = True

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def capability(self) -> Capability:
        if self.settings.arcgis_token is None:
            return Capability(state=CapabilityState.not_configured, message="No ArcGIS token configured")
        return Capability(
            state=CapabilityState.manual_input_required,
            message="Token present, but the adapter stays disabled until auth, cost and caching terms are verified",
        )
