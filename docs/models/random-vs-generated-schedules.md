# Random vs generated qualification schedules — D-17 rung 2, measured at N=1000 per arm

**Random schedules reproduce generated schedules' rank bands to within the noise of either construction's own resampling.** Across 6 real finished events (244 teams) at N=1000 schedules per arm (20000 draws), plain-random schedules agree with balanced cheesy-arena template schedules on 74.2% of teams within half a rank of median. The controls: generated-vs-generated 74.2%, random-vs-random 77.9% — two independent draws of ONE construction, which is what perfect agreement looks like at this N. The cross-construction gap is 7.0pp against a spread of 3.7pp between the two floors themselves, and clause 3 finds no systematic shift in any comparison (largest |mean signed median shift| 0.0078 ranks, tolerance 0.25).

**Rung 1's clauses are not a usable bar at any N measured here, and every row below reads FAIL because of it.** Clause 1 asks for 95.0% of teams within 0.5 ranks of median, and BOTH same-construction floors miss it — generated-vs-generated at 74.2%, random-vs-random at 77.9%. Two arms that are IDENTICAL by construction cannot clear it, so a candidate's FAIL against it distinguishes nothing. At the PUBLISHED N=20 the floor is worse still: 27.5%, with its worst team's median moving 14.19 ranks between two draws of the same construction. That is the number to hold any N=20 pre-schedule measurement against — including `docs/models/field-averaged-presim.md`'s, whose headline worst team moved 7.59 ranks. That document's own seed-noise control held the 20 schedules FIXED and varied only the draw seed, so it measured a strictly smaller floor than the one that applies.

**This document is WRITTEN BY `scripts/measureRandomSchedules.ts --write-doc`, not transcribed from its terminal output.**

```json random-vs-generated-schedules
{
  "algorithm": "bpr@3.0.0+baseline",
  "scheduleCount": 1000,
  "drawsPerSchedule": 20,
  "drawsPerArm": 20000,
  "publishedScheduleCount": 20,
  "publishedDrawsPerSchedule": 50,
  "eventCount": 6,
  "teamCount": 244,
  "pooled": {
    "randVsGen": {
      "pass": false,
      "clause1TightRate": 0.7418032786885246,
      "clause1EveryTeamWithinHard": false,
      "clause1Worst": {
        "absMedianDiff": 1.7442247200016006,
        "teamKey": "frc3255",
        "eventKey": "2026joh"
      },
      "clause2P10Rate": 0.9180327868852459,
      "clause2P90Rate": 0.9098360655737705,
      "clause3MeanSignedMedianDiff": -0.00777009166231501,
      "teamCount": 244
    },
    "genBVsGenA": {
      "pass": false,
      "clause1TightRate": 0.7418032786885246,
      "clause1EveryTeamWithinHard": false,
      "clause1Worst": {
        "absMedianDiff": 1.6348114557019855,
        "teamKey": "frc48",
        "eventKey": "2026joh"
      },
      "clause2P10Rate": 0.9385245901639344,
      "clause2P90Rate": 0.9426229508196722,
      "clause3MeanSignedMedianDiff": -0.0040594700805157485,
      "teamCount": 244
    },
    "randVsGenB": {
      "pass": false,
      "clause1TightRate": 0.7090163934426229,
      "clause1EveryTeamWithinHard": false,
      "clause1Worst": {
        "absMedianDiff": 1.6871794871794847,
        "teamKey": "frc2638",
        "eventKey": "2026joh"
      },
      "clause2P10Rate": 0.9098360655737705,
      "clause2P90Rate": 0.889344262295082,
      "clause3MeanSignedMedianDiff": -0.0037106215817992614,
      "teamCount": 244
    },
    "randBVsRand": {
      "pass": false,
      "clause1TightRate": 0.7786885245901639,
      "clause1EveryTeamWithinHard": false,
      "clause1Worst": {
        "absMedianDiff": 1.8576408687989243,
        "teamKey": "frc7563",
        "eventKey": "2026joh"
      },
      "clause2P10Rate": 0.9467213114754098,
      "clause2P90Rate": 0.9467213114754098,
      "clause3MeanSignedMedianDiff": 0.004252508362331042,
      "teamCount": 244
    },
    "randVsGenPublishedN": {
      "pass": false,
      "clause1TightRate": 0.2540983606557377,
      "clause1EveryTeamWithinHard": false,
      "clause1Worst": {
        "absMedianDiff": 9.365384615384613,
        "teamKey": "frc6324",
        "eventKey": "2026joh"
      },
      "clause2P10Rate": 0.5081967213114754,
      "clause2P90Rate": 0.4959016393442623,
      "clause3MeanSignedMedianDiff": 0.00929690812945127,
      "teamCount": 244
    },
    "genBVsGenAPublishedN": {
      "pass": false,
      "clause1TightRate": 0.27459016393442626,
      "clause1EveryTeamWithinHard": false,
      "clause1Worst": {
        "absMedianDiff": 14.19190404797601,
        "teamKey": "frc9484",
        "eventKey": "2026joh"
      },
      "clause2P10Rate": 0.5532786885245902,
      "clause2P90Rate": 0.5573770491803278,
      "clause3MeanSignedMedianDiff": 0.005165288737111111,
      "teamCount": 244
    }
  },
  "events": [
    {
      "eventKey": "2022on034",
      "season": 2022,
      "teams": 14,
      "quals": 21,
      "matchesPerTeam": 9,
      "templateRows": 21,
      "surrogateSlots": 0,
      "replayMode": "cold (target season 2022 only, assumption A-FA3)",
      "duplicateRowsTotal": 0,
      "structure": {
        "generated": {
          "repeatPartnerPairs": 33,
          "repeatOpponentPairs": 69,
          "meanRedBlueImbalance": 1,
          "maxRedBlueImbalance": 1
        },
        "random": {
          "repeatPartnerPairs": 38.65,
          "repeatOpponentPairs": 62.2,
          "meanRedBlueImbalance": 2.7285714285714286,
          "maxRedBlueImbalance": 9
        }
      },
      "randVsGen": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.38338013338013344,
          "teamKey": "frc2013",
          "eventKey": "2022on034"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.009522402709121525,
        "teamCount": 14
      },
      "genBVsGenA": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.18945088265020793,
          "teamKey": "frc6864",
          "eventKey": "2022on034"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.0027992970681848884,
        "teamCount": 14
      },
      "randVsGenB": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.4580503470578563,
          "teamKey": "frc6864",
          "eventKey": "2022on034"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.012321699777306414,
        "teamCount": 14
      },
      "randBVsRand": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.446939867851464,
          "teamKey": "frc8729",
          "eventKey": "2022on034"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.003964354928259433,
        "teamCount": 14
      },
      "randVsGenPublishedN": {
        "pass": false,
        "clause1TightRate": 0.6428571428571429,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.2745442768575934,
          "teamKey": "frc3543",
          "eventKey": "2022on034"
        },
        "clause2P10Rate": 0.7857142857142857,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.04127056135299904,
        "teamCount": 14
      },
      "genBVsGenAPublishedN": {
        "pass": false,
        "clause1TightRate": 0.5,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.1862101872837894,
          "teamKey": "frc2706",
          "eventKey": "2022on034"
        },
        "clause2P10Rate": 0.8571428571428571,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.014476070914018781,
        "teamCount": 14
      }
    },
    {
      "eventKey": "2023gaalb",
      "season": 2023,
      "teams": 21,
      "quals": 42,
      "matchesPerTeam": 12,
      "templateRows": 42,
      "surrogateSlots": 0,
      "replayMode": "cold (target season 2023 only, assumption A-FA3)",
      "duplicateRowsTotal": 0,
      "structure": {
        "generated": {
          "repeatPartnerPairs": 48,
          "repeatOpponentPairs": 132,
          "meanRedBlueImbalance": 0.5714285714285713,
          "maxRedBlueImbalance": 2
        },
        "random": {
          "repeatPartnerPairs": 72.35,
          "repeatOpponentPairs": 120.15,
          "meanRedBlueImbalance": 2.914285714285714,
          "maxRedBlueImbalance": 12
        }
      },
      "randVsGen": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.17199829724472337,
          "teamKey": "frc4112",
          "eventKey": "2023gaalb"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.0014572279734569264,
        "teamCount": 21
      },
      "genBVsGenA": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.20329573696815118,
          "teamKey": "frc4701",
          "eventKey": "2023gaalb"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.0039031513090873765,
        "teamCount": 21
      },
      "randVsGenB": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.1607088665216736,
          "teamKey": "frc4112",
          "eventKey": "2023gaalb"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.00244592333563045,
        "teamCount": 21
      },
      "randBVsRand": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.21675914446998767,
          "teamKey": "frc3329",
          "eventKey": "2023gaalb"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.007147936319154235,
        "teamCount": 21
      },
      "randVsGenPublishedN": {
        "pass": false,
        "clause1TightRate": 0.6666666666666666,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.0506493506493504,
          "teamKey": "frc4112",
          "eventKey": "2023gaalb"
        },
        "clause2P10Rate": 0.9523809523809523,
        "clause2P90Rate": 0.9047619047619048,
        "clause3MeanSignedMedianDiff": 0.029467441359899753,
        "teamCount": 21
      },
      "genBVsGenAPublishedN": {
        "pass": false,
        "clause1TightRate": 0.8571428571428571,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.8794642857142865,
          "teamKey": "frc8137",
          "eventKey": "2023gaalb"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 0.9523809523809523,
        "clause3MeanSignedMedianDiff": 0.012572151784891667,
        "teamCount": 21
      }
    },
    {
      "eventKey": "2024caav",
      "season": 2024,
      "teams": 40,
      "quals": 74,
      "matchesPerTeam": 11,
      "templateRows": 74,
      "surrogateSlots": 4,
      "replayMode": "cold (target season 2024 only, assumption A-FA3)",
      "duplicateRowsTotal": 0,
      "structure": {
        "generated": {
          "repeatPartnerPairs": 0,
          "repeatOpponentPairs": 85,
          "meanRedBlueImbalance": 1.1,
          "maxRedBlueImbalance": 3
        },
        "random": {
          "repeatPartnerPairs": 82.6,
          "repeatOpponentPairs": 159.45,
          "meanRedBlueImbalance": 2.8,
          "maxRedBlueImbalance": 11
        }
      },
      "randVsGen": {
        "pass": false,
        "clause1TightRate": 0.775,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.0424334197780887,
          "teamKey": "frc3993",
          "eventKey": "2024caav"
        },
        "clause2P10Rate": 0.8,
        "clause2P90Rate": 0.775,
        "clause3MeanSignedMedianDiff": 0.005959631692362211,
        "teamCount": 40
      },
      "genBVsGenA": {
        "pass": true,
        "clause1TightRate": 0.95,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.7834370564472124,
          "teamKey": "frc7607",
          "eventKey": "2024caav"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.002723005890669672,
        "teamCount": 40
      },
      "randVsGenB": {
        "pass": false,
        "clause1TightRate": 0.725,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.0743851559068958,
          "teamKey": "frc3993",
          "eventKey": "2024caav"
        },
        "clause2P10Rate": 0.8,
        "clause2P90Rate": 0.725,
        "clause3MeanSignedMedianDiff": 0.008682637583031883,
        "teamCount": 40
      },
      "randBVsRand": {
        "pass": false,
        "clause1TightRate": 0.9,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.8372510451559307,
          "teamKey": "frc3993",
          "eventKey": "2024caav"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.005212631528137423,
        "teamCount": 40
      },
      "randVsGenPublishedN": {
        "pass": false,
        "clause1TightRate": 0.175,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 5.666666666666668,
          "teamKey": "frc7607",
          "eventKey": "2024caav"
        },
        "clause2P10Rate": 0.55,
        "clause2P90Rate": 0.475,
        "clause3MeanSignedMedianDiff": -0.030749161377708646,
        "teamCount": 40
      },
      "genBVsGenAPublishedN": {
        "pass": false,
        "clause1TightRate": 0.325,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 2.528997289972903,
          "teamKey": "frc6305",
          "eventKey": "2024caav"
        },
        "clause2P10Rate": 0.675,
        "clause2P90Rate": 0.75,
        "clause3MeanSignedMedianDiff": -0.032737610683375974,
        "teamCount": 40
      }
    },
    {
      "eventKey": "2025cur",
      "season": 2025,
      "teams": 76,
      "quals": 127,
      "matchesPerTeam": 10,
      "templateRows": 127,
      "surrogateSlots": 2,
      "replayMode": "cold (target season 2025 only, assumption A-FA3)",
      "duplicateRowsTotal": 0,
      "structure": {
        "generated": {
          "repeatPartnerPairs": 0,
          "repeatOpponentPairs": 1,
          "meanRedBlueImbalance": 0.9210526315789472,
          "maxRedBlueImbalance": 3
        },
        "random": {
          "repeatPartnerPairs": 74.85,
          "repeatOpponentPairs": 156.3,
          "meanRedBlueImbalance": 2.5328947368421053,
          "maxRedBlueImbalance": 10
        }
      },
      "randVsGen": {
        "pass": false,
        "clause1TightRate": 0.631578947368421,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.2324204293116239,
          "teamKey": "frc5530",
          "eventKey": "2025cur"
        },
        "clause2P10Rate": 0.9078947368421053,
        "clause2P90Rate": 0.9473684210526315,
        "clause3MeanSignedMedianDiff": -0.012029014968953956,
        "teamCount": 76
      },
      "genBVsGenA": {
        "pass": false,
        "clause1TightRate": 0.631578947368421,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.2963567116987704,
          "teamKey": "frc1391",
          "eventKey": "2025cur"
        },
        "clause2P10Rate": 0.9078947368421053,
        "clause2P90Rate": 0.9342105263157895,
        "clause3MeanSignedMedianDiff": -0.002198143740424941,
        "teamCount": 76
      },
      "randVsGenB": {
        "pass": false,
        "clause1TightRate": 0.6447368421052632,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.3254413147174553,
          "teamKey": "frc4020",
          "eventKey": "2025cur"
        },
        "clause2P10Rate": 0.9078947368421053,
        "clause2P90Rate": 0.9342105263157895,
        "clause3MeanSignedMedianDiff": -0.009830871228529015,
        "teamCount": 76
      },
      "randBVsRand": {
        "pass": false,
        "clause1TightRate": 0.631578947368421,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.7394243257964064,
          "teamKey": "frc1073",
          "eventKey": "2025cur"
        },
        "clause2P10Rate": 0.8947368421052632,
        "clause2P90Rate": 0.9605263157894737,
        "clause3MeanSignedMedianDiff": 0.02781897184149304,
        "teamCount": 76
      },
      "randVsGenPublishedN": {
        "pass": false,
        "clause1TightRate": 0.15789473684210525,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 9.007843137254902,
          "teamKey": "frc1498",
          "eventKey": "2025cur"
        },
        "clause2P10Rate": 0.32894736842105265,
        "clause2P90Rate": 0.40789473684210525,
        "clause3MeanSignedMedianDiff": 0.032748284393061086,
        "teamCount": 76
      },
      "genBVsGenAPublishedN": {
        "pass": false,
        "clause1TightRate": 0.11842105263157894,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 12.922619047619047,
          "teamKey": "frc3539",
          "eventKey": "2025cur"
        },
        "clause2P10Rate": 0.35526315789473684,
        "clause2P90Rate": 0.4342105263157895,
        "clause3MeanSignedMedianDiff": 0.037886204213257,
        "teamCount": 76
      }
    },
    {
      "eventKey": "2026joh",
      "season": 2026,
      "teams": 75,
      "quals": 125,
      "matchesPerTeam": 10,
      "templateRows": 125,
      "surrogateSlots": 0,
      "replayMode": "cold (target season 2026 only, assumption A-FA3)",
      "duplicateRowsTotal": 0,
      "structure": {
        "generated": {
          "repeatPartnerPairs": 0,
          "repeatOpponentPairs": 0,
          "meanRedBlueImbalance": 0.8000000000000002,
          "maxRedBlueImbalance": 2
        },
        "random": {
          "repeatPartnerPairs": 74.3,
          "repeatOpponentPairs": 157.45,
          "meanRedBlueImbalance": 2.501333333333333,
          "maxRedBlueImbalance": 8
        }
      },
      "randVsGen": {
        "pass": false,
        "clause1TightRate": 0.6533333333333333,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.7442247200016006,
          "teamKey": "frc3255",
          "eventKey": "2026joh"
        },
        "clause2P10Rate": 0.9333333333333333,
        "clause2P90Rate": 0.88,
        "clause3MeanSignedMedianDiff": -0.01799095741523253,
        "teamCount": 75
      },
      "genBVsGenA": {
        "pass": false,
        "clause1TightRate": 0.56,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.6348114557019855,
          "teamKey": "frc48",
          "eventKey": "2026joh"
        },
        "clause2P10Rate": 0.8933333333333333,
        "clause2P90Rate": 0.88,
        "clause3MeanSignedMedianDiff": -0.008888067519347332,
        "teamCount": 75
      },
      "randVsGenB": {
        "pass": false,
        "clause1TightRate": 0.56,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.6871794871794847,
          "teamKey": "frc2638",
          "eventKey": "2026joh"
        },
        "clause2P10Rate": 0.9066666666666666,
        "clause2P90Rate": 0.8533333333333334,
        "clause3MeanSignedMedianDiff": -0.009102889895885197,
        "teamCount": 75
      },
      "randBVsRand": {
        "pass": false,
        "clause1TightRate": 0.7066666666666667,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.8576408687989243,
          "teamKey": "frc7563",
          "eventKey": "2026joh"
        },
        "clause2P10Rate": 0.9333333333333333,
        "clause2P90Rate": 0.8666666666666667,
        "clause3MeanSignedMedianDiff": -0.017621133886704166,
        "teamCount": 75
      },
      "randVsGenPublishedN": {
        "pass": false,
        "clause1TightRate": 0.10666666666666667,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 9.365384615384613,
          "teamKey": "frc6324",
          "eventKey": "2026joh"
        },
        "clause2P10Rate": 0.37333333333333335,
        "clause2P90Rate": 0.26666666666666666,
        "clause3MeanSignedMedianDiff": 0.011270718934065442,
        "teamCount": 75
      },
      "genBVsGenAPublishedN": {
        "pass": false,
        "clause1TightRate": 0.08,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 14.19190404797601,
          "teamKey": "frc9484",
          "eventKey": "2026joh"
        },
        "clause2P10Rate": 0.4,
        "clause2P90Rate": 0.28,
        "clause3MeanSignedMedianDiff": -0.00008257049373090316,
        "teamCount": 75
      }
    },
    {
      "eventKey": "2026txmca",
      "season": 2026,
      "teams": 18,
      "quals": 36,
      "matchesPerTeam": 12,
      "templateRows": 36,
      "surrogateSlots": 0,
      "replayMode": "cold (target season 2026 only, assumption A-FA3)",
      "duplicateRowsTotal": 0,
      "structure": {
        "generated": {
          "repeatPartnerPairs": 55,
          "repeatOpponentPairs": 120,
          "meanRedBlueImbalance": 1.111111111111111,
          "maxRedBlueImbalance": 2
        },
        "random": {
          "repeatPartnerPairs": 64.2,
          "repeatOpponentPairs": 100.95,
          "meanRedBlueImbalance": 3.1111111111111116,
          "maxRedBlueImbalance": 12
        }
      },
      "randVsGen": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.20933732663107385,
          "teamKey": "frc4063",
          "eventKey": "2026txmca"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.0019264508270393004,
        "teamCount": 18
      },
      "genBVsGenA": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.22357310726875923,
          "teamKey": "frc4597",
          "eventKey": "2026txmca"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.005039027462886499,
        "teamCount": 18
      },
      "randVsGenB": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.24384087727456105,
          "teamKey": "frc4063",
          "eventKey": "2026txmca"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.0031125766358471984,
        "teamCount": 18
      },
      "randBVsRand": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.18839761988842874,
          "teamKey": "frc4295",
          "eventKey": "2026txmca"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.007280869696623683,
        "teamCount": 18
      },
      "randVsGenPublishedN": {
        "pass": false,
        "clause1TightRate": 0.6666666666666666,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.8292622133599208,
          "teamKey": "frc10385",
          "eventKey": "2026txmca"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.057353645707387865,
        "teamCount": 18
      },
      "genBVsGenAPublishedN": {
        "pass": false,
        "clause1TightRate": 0.7777777777777778,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.813574660633483,
          "teamKey": "frc10118",
          "eventKey": "2026txmca"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.04277800190369755,
        "teamCount": 18
      }
    }
  ]
}
```

## The comparison table

| Comparison | Clause 1 (≥95% within 0.5) | Every team ≤1 | Clause 2 p10 (≥90%) | Clause 2 p90 (≥90%) | Clause 3 mean signed (±0.25) | Worst \|Δmedian\| | Verdict |
|---|---|---|---|---|---|---|---|
| random vs generated (ref A), N=1000 | 74.2% | false | 91.8% | 91.0% | -0.0078 | 1.74 (frc3255 @ 2026joh) | FAIL |
| random vs generated (ref B), N=1000 | 70.9% | false | 91.0% | 88.9% | -0.0037 | 1.69 (frc2638 @ 2026joh) | FAIL |
| **generated-vs-generated floor**, N=1000 | 74.2% | false | 93.9% | 94.3% | -0.0041 | 1.63 (frc48 @ 2026joh) | FAIL |
| **random-vs-random floor**, N=1000 | 77.9% | false | 94.7% | 94.7% | 0.0043 | 1.86 (frc7563 @ 2026joh) | FAIL |
| random vs generated, N=20 (published config) | 25.4% | false | 50.8% | 49.6% | 0.0093 | 9.37 (frc6324 @ 2026joh) | FAIL |
| **same-arm floor**, N=20 (published config) | 27.5% | false | 55.3% | 55.7% | 0.0052 | 14.19 (frc9484 @ 2026joh) | FAIL |

The floor rows are the controls: both sides are the SAME construction, differing only in the permutation and draw streams. A candidate row cannot be read as a failure unless it is materially worse than the floors. Note that the random-vs-random floor is not worse than the generated-vs-generated floor — the random construction is no more variable schedule-to-schedule than the balanced one, so a shortfall in the cross-construction rows cannot be explained as "random needs more schedules to converge".

## What this does and does not license

- **Licensed:** dropping the cheesy-arena template dependency for the pre-schedule sidecar, and with it D-19's redistribution question. The rank bands a visitor sees would move by less than the amount they already move between two runs of the shipped construction.
- **NOT licensed:** any claim that rung 1 (the field-averaged, no-schedule predictor) passes. That arm was not re-run here. What this run does establish about it is narrower and purely methodological: the reference it was scored against disagrees with ITSELF by more, at N=20, than the deviations it was failed for — so its FAIL does not separate "the candidate is wrong" from "the reference is noisy". It needs re-measuring at this N before its verdict means anything.
- **NOT licensed:** reading any row's FAIL as a finding. The bar fails for identical constructions; see the headline.

## Per event

| Event | Season | Teams | Quals | mpt | Replay | rand-vs-gen c1 | floor c1 | rand-vs-gen c3 |
|---|---|---|---|---|---|---|---|---|
| `2022on034` | 2022 | 14 | 21 | 9 | cold (target season 2022 only, assumption A-FA3) | 100.0% | 100.0% | 0.010 |
| `2023gaalb` | 2023 | 21 | 42 | 12 | cold (target season 2023 only, assumption A-FA3) | 100.0% | 100.0% | 0.001 |
| `2024caav` | 2024 | 40 | 74 | 11 | cold (target season 2024 only, assumption A-FA3) | 77.5% | 95.0% | 0.006 |
| `2025cur` | 2025 | 76 | 127 | 10 | cold (target season 2025 only, assumption A-FA3) | 63.2% | 63.2% | -0.012 |
| `2026joh` | 2026 | 75 | 125 | 10 | cold (target season 2026 only, assumption A-FA3) | 65.3% | 56.0% | -0.018 |
| `2026txmca` | 2026 | 18 | 36 | 12 | cold (target season 2026 only, assumption A-FA3) | 100.0% | 100.0% | -0.002 |

## The two constructions are actually different (not part of the criterion)

| Event | Repeat-partner pairs (gen) | (rand) | Repeat-opponent pairs (gen) | (rand) | Mean red/blue imbalance (gen) | (rand) |
|---|---|---|---|---|---|---|
| `2022on034` | 33.0 | 38.6 | 69.0 | 62.2 | 1.00 | 2.73 |
| `2023gaalb` | 48.0 | 72.3 | 132.0 | 120.2 | 0.57 | 2.91 |
| `2024caav` | 0.0 | 82.6 | 85.0 | 159.4 | 1.10 | 2.80 |
| `2025cur` | 0.0 | 74.8 | 1.0 | 156.3 | 0.92 | 2.53 |
| `2026joh` | 0.0 | 74.3 | 0.0 | 157.4 | 0.80 | 2.50 |
| `2026txmca` | 55.0 | 64.2 | 120.0 | 101.0 | 1.11 | 3.11 |

If these columns matched, a PASS above would be a statement about two identical things. They do not match: the random arm repeats partners and opponents freely and does not balance red/blue appearances, which is exactly the structure the balanced template exists to impose.

## Caveats

- **The random construction is a randomised sequential deal, not a uniform draw** from the space of duplicate-free schedules: appearances are poured into one bag, shuffled, and dealt into rows of six, scanning forward for the first entry whose team is not already in the row. Rows the repair could not fix are counted and reported (0 across this run).
- **Both arms hold every team's credited match count fixed** at the template's own `appearancesPerTeam`, and reproduce its surrogate-slot count. The random arm chooses WHICH teams take the surrogate appearances itself, since that choice is part of the structure under test.
- **Neither arm is validated against realised rankings.** This measures agreement between two forecasts of the same event, not the accuracy of either.
- **One replay and one pricing state per event, shared by all three arms.** Every difference reported here is the schedule construction and the draw stream, nothing else.
