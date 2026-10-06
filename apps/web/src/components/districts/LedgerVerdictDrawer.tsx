/**
 * THE ONE PANE a blue cell opens on either Locks tab (sketch 025 variant A,
 * quick task 261006-lxp).
 *
 * It reads top down as an answer: the eyebrow names the cell and the team, the
 * headline answers what the click asked, the tiles back it with two or three
 * figures, the note says what "likely" means, and one chart shows it. A total
 * adds one source line under its chart. No captions and no computation
 * disclosure.
 *
 * Every word and number comes from `buildVerdictModel` in `ledgerVerdict.ts`;
 * this component only lays them out. Every string reaches the page as a React
 * text child, never as markup. Class lists are plain strings, never `cn()`.
 */
import { DISTRICT_LEDGER_VERDICT_NOTE } from "./districtLedgerCopy.js";
import { DistrictOutcomeList } from "./DistrictOutcomeList.js";
import { DistrictPointHistogram } from "./DistrictPointHistogram.js";
import type { VerdictModel, VerdictSourceChip } from "./ledgerVerdict.js";

function SourceChip({ chip }: { chip: VerdictSourceChip }) {
  switch (chip.kind) {
    case "earned":
      return (
        <span>
          <b>{chip.figure}</b> {chip.text}
        </span>
      );
    case "predicted":
      return (
        <span>
          <span className="district-ledger-verdict__pred">{chip.figure}</span> {chip.text}
        </span>
      );
    case "note":
      return <span>{chip.text}</span>;
    case "category":
      return chip.open ? (
        <span>
          {chip.label} <b>{chip.figure}</b>
          {chip.small !== undefined && (
            <>
              {" "}
              <i>{chip.small}</i>
            </>
          )}
        </span>
      ) : (
        <span>
          {chip.label} {chip.figure}
        </span>
      );
  }
}

export function VerdictDrawer({ model }: { model: VerdictModel }) {
  const { chart } = model;
  return (
    <div className="district-ledger-verdict" data-testid="district-ledger-verdict">
      <div className="district-ledger-verdict__summary">
        <div className="district-ledger-verdict__eyebrow" data-testid="district-ledger-verdict-eyebrow">
          {model.eyebrow}
        </div>
        <h3 className="district-ledger-verdict__headline" data-testid="district-ledger-verdict-headline">
          {model.headline}
        </h3>
        <div className="district-ledger-verdict__tiles" data-testid="district-ledger-verdict-tiles">
          {model.tiles.map((tile, index) => (
            <div
              key={tile.key}
              className={index === 0 ? "district-ledger-verdict__tile district-ledger-verdict__tile--lead" : "district-ledger-verdict__tile"}
              data-testid="district-ledger-verdict-tile"
              data-tile={tile.key}
            >
              <span className="district-ledger-verdict__tile-label">{tile.label}</span>
              <b className="district-ledger-verdict__tile-value">{tile.value}</b>
            </div>
          ))}
        </div>
        <p className="district-ledger-verdict__note" data-testid="district-ledger-verdict-note">
          {DISTRICT_LEDGER_VERDICT_NOTE}
        </p>
      </div>
      <div className="district-ledger-verdict__chart">
        {chart.kind === "histogram" ? (
          <DistrictPointHistogram
            testId={chart.testId}
            label={chart.label}
            counts={chart.counts}
            denominator={chart.denominator}
            maxPoints={chart.maxPoints}
            p10={chart.p10}
            p50={chart.p50}
            p90={chart.p90}
            {...(chart.cutoff === undefined
              ? {}
              : {
                  cutoff: {
                    position: chart.cutoff.position,
                    label: chart.cutoff.label,
                    ...(chart.cutoff.zone === undefined ? {} : { zone: chart.cutoff.zone }),
                  },
                })}
            {...(chart.capLabel === undefined ? {} : { capLabel: chart.capLabel })}
          />
        ) : (
          <DistrictOutcomeList testId="district-ledger-drawer-outcomes" rows={chart.rows} label={chart.label} />
        )}
        {model.sourceChips.length > 0 && (
          <div className="district-ledger-verdict__source" data-testid="district-ledger-verdict-source">
            {model.sourceChips.map((chip, index) => (
              <SourceLinePart key={index} chip={chip} first={index === 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One chip, preceded by its middle dot separator unless it is the first. */
function SourceLinePart({ chip, first }: { chip: VerdictSourceChip; first: boolean }) {
  return (
    <>
      {!first && <span className="district-ledger-verdict__sep">·</span>}
      <SourceChip chip={chip} />
    </>
  );
}
