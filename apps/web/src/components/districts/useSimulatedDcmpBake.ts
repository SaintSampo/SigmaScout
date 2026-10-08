/**
 * THE CHAMP LOCKS DCMP BAKE (quick task 261007-mxf): at a rewound stop before
 * any District Championship has started, the championship is baked in the Web
 * Worker over generated schedules as if its field were the teams the district
 * tier SHOWS as Prequalified, Locked or In range at the stop, at the stop's own
 * as-of state.
 *
 * A SECOND REQUEST, through its own `useDistrictSimulationRun` instance. The
 * field is a function of the main run's OUTPUT: the per event run feeds the
 * district chance run, which settles the district line, which cuts In range.
 * Folding the championship into the main request would move that request's
 * signature the moment the field landed, and `useDistrictSimulationRun` keys
 * its effect on the whole signature, so every district event would be
 * terminated and re-run. It would also make the district run's own pending
 * state wait on its downstream.
 *
 * WHY IT WAITS FOR THE SETTLED FIELD. Nothing is assembled until
 * `dcmpSimulatedField` is ready, so a provisional In range set is never baked
 * and thrown away. The signature folds the roster and the cut, so only a field
 * or stop change re-bakes, and an empty request (inactive, or the field not in
 * yet) posts nothing at all: SC-5 lives in the run hook.
 */
import { useMemo } from "react";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { SimulatedDcmpBake, SimulatedDcmpField } from "./champLedgerRows.js";
import { assembleSimulatedDcmpBake, simulatedDcmpBakeView, type AssembledSimulatedDcmpBake } from "./districtRunAssembly.js";
import type { AsOfRewindView } from "./useAsOfRewind.js";
import { useDistrictSimulationRun, type DistrictSimulationRunRequest, type DistrictSimulationRunState } from "./useDistrictSimulationRun.js";

export interface UseSimulatedDcmpBakeOptions {
  /** A rewound stop, before any championship has started, in a district that publishes one. */
  readonly active: boolean;
  readonly asOf: AsOfRewindView | undefined;
  readonly artifact: DistrictArtifact;
  /** The championship to bake under: the one planned GENERATED over every district team. */
  readonly eventKey: string | undefined;
  /** `undefined` while inactive. */
  readonly field: SimulatedDcmpField | undefined;
}

export interface SimulatedDcmpBakeResult {
  readonly bake: SimulatedDcmpBake;
  /** The bake request's signature, `""` while nothing is posted. The champ run's signature carries it. */
  readonly signature: string;
  readonly runState: DistrictSimulationRunState;
}

/** Nothing to bake: posts nothing (SC-5). */
const EMPTY_REQUEST: DistrictSimulationRunRequest = { events: [], signature: "" };

export function useSimulatedDcmpBake(options: UseSimulatedDcmpBakeOptions): SimulatedDcmpBakeResult {
  const { active, asOf, artifact, eventKey, field } = options;

  const assembled = useMemo((): AssembledSimulatedDcmpBake | undefined => {
    if (!active || field?.status !== "ready" || asOf?.status !== "ready" || eventKey === undefined) return undefined;
    return assembleSimulatedDcmpBake({
      artifact,
      result: asOf.result,
      algorithmVersion: asOf.algorithmVersion,
      eventKey,
      roster: field.roster,
    });
  }, [active, field, asOf, eventKey, artifact]);

  const request = useMemo(
    (): DistrictSimulationRunRequest =>
      assembled?.status === "ready" ? { events: [assembled.request], signature: assembled.signature } : EMPTY_REQUEST,
    [assembled]
  );
  const runState = useDistrictSimulationRun(request);

  const bake = useMemo(() => simulatedDcmpBakeView({ asOf, assembled, runState }), [asOf, assembled, runState]);
  return { bake, signature: request.signature, runState };
}
