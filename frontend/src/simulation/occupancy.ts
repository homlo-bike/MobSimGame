/**
 * Occupancy of shared track for the simulation.
 *
 * A resource is a single-track block (opposing directions exclude each other)
 * or one track or route (only following vehicles interact). Reservations are
 * time intervals [enter, exit] with a direction sign. A vehicle may enter when
 * no opposing reservation overlaps its own interval and it stays at least the
 * separation time behind (or ahead of) every vehicle in the same direction.
 * Pure data structure: no clock, no randomness.
 */
export interface ResourceSpan {
  /** Line chainage, metres, fromM < toM. */
  fromM: number;
  toM: number;
  resourceId: string;
  /** Travel direction relative to the resource's reference direction. */
  sign: 1 | -1;
  /** True for single-track blocks: vehicles of the other direction must wait. */
  opposing: boolean;
}

interface Reservation {
  enter: number;
  exit: number;
  sign: 1 | -1;
  /** Vehicles of one queue (same line and direction) never overtake each other. */
  queue: string;
}

export class OccupancyLedger {
  private byResource = new Map<string, Reservation[]>();

  /**
   * Reserve `durationS` of the resource from the earliest time ≥ `arriveS` that
   * is free, and return that time. Waiting happens outside the resource.
   */
  reserve(
    resourceId: string,
    sign: 1 | -1,
    opposing: boolean,
    arriveS: number,
    durationS: number,
    separationS: number,
    queue = '',
  ): number {
    const list = this.byResource.get(resourceId) ?? [];
    let s = arriveS;
    for (let guard = 0; guard < 10000; guard++) {
      let moved = false;
      for (const r of list) {
        if (r.sign !== sign) {
          if (opposing && s < r.exit && s + durationS > r.enter) {
            s = r.exit;
            moved = true;
          }
          continue;
        }
        const behind = s >= r.enter + separationS && s + durationS >= r.exit + separationS;
        const ahead =
          (!queue || r.queue !== queue) &&
          s + separationS <= r.enter &&
          s + durationS + separationS <= r.exit;
        if (!behind && !ahead) {
          s = Math.max(r.enter + separationS, r.exit + separationS - durationS);
          moved = true;
        }
      }
      if (!moved) break;
    }
    list.push({ enter: s, exit: s + durationS, sign, queue });
    this.byResource.set(resourceId, list);
    return s;
  }

  /** Forget reservations that ended before `timeS` (no later trip can reach them). */
  prune(timeS: number) {
    for (const [id, list] of this.byResource) {
      const kept = list.filter((r) => r.exit >= timeS);
      if (kept.length !== list.length) this.byResource.set(id, kept);
    }
  }

  reservations(resourceId: string): readonly Reservation[] {
    return this.byResource.get(resourceId) ?? [];
  }
}
