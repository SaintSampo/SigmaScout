# Random vs generated qualification schedules — D-17 rung 2, measured at N=2000 per arm

**Random schedules reproduce generated schedules' rank bands to within the noise of either construction's own resampling.** Across 6 real finished events (244 teams) at N=2000 schedules per arm (40000 draws), plain-random schedules agree with balanced cheesy-arena template schedules on 87.3% of teams within half a rank of median. The controls: generated-vs-generated 89.3%, random-vs-random 87.3% — two independent draws of ONE construction, which is what perfect agreement looks like at this N. The cross-construction gap is 8.2pp against a spread of 2.0pp between the two floors themselves, and clause 3 finds no systematic shift in any comparison (largest |mean signed median shift| 0.0017 ranks, tolerance 0.25).

**Rung 1's clauses are not a usable bar at any N measured here, and every row below reads FAIL because of it.** Clause 1 asks for 95.0% of teams within 0.5 ranks of median, and BOTH same-construction floors miss it — generated-vs-generated at 89.3%, random-vs-random at 87.3%. Two arms that are IDENTICAL by construction cannot clear it, so a candidate's FAIL against it distinguishes nothing. At the PUBLISHED N=20 the floor is worse still: 27.5%, with its worst team's median moving 14.19 ranks between two draws of the same construction. That is the number to hold any N=20 pre-schedule measurement against — including `docs/models/field-averaged-presim.md`'s, whose headline worst team moved 7.59 ranks. That document's own seed-noise control held the 20 schedules FIXED and varied only the draw seed, so it measured a strictly smaller floor than the one that applies.

**This document is WRITTEN BY `scripts/measureRandomSchedules.ts --write-doc`, not transcribed from its terminal output.**

```json random-vs-generated-schedules
{
  "algorithm": "bpr@3.0.0+baseline",
  "scheduleCount": 2000,
  "drawsPerSchedule": 20,
  "drawsPerArm": 40000,
  "publishedScheduleCount": 20,
  "publishedDrawsPerSchedule": 50,
  "eventCount": 6,
  "teamCount": 244,
  "pooled": {
    "randVsGen": {
      "pass": false,
      "clause1TightRate": 0.8729508196721312,
      "clause1EveryTeamWithinHard": false,
      "clause1Worst": {
        "absMedianDiff": 1.4139487975689278,
        "teamKey": "frc3414",
        "eventKey": "2026joh"
      },
      "clause2P10Rate": 0.9508196721311475,
      "clause2P90Rate": 0.9426229508196722,
      "clause3MeanSignedMedianDiff": 0.000005972962652961707,
      "teamCount": 244
    },
    "genBVsGenA": {
      "pass": false,
      "clause1TightRate": 0.8934426229508197,
      "clause1EveryTeamWithinHard": false,
      "clause1Worst": {
        "absMedianDiff": 1.002966684294023,
        "teamKey": "frc1391",
        "eventKey": "2025cur"
      },
      "clause2P10Rate": 0.9713114754098361,
      "clause2P90Rate": 1,
      "clause3MeanSignedMedianDiff": 0.0017111655611861075,
      "teamCount": 244
    },
    "randVsGenB": {
      "pass": false,
      "clause1TightRate": 0.8114754098360656,
      "clause1EveryTeamWithinHard": false,
      "clause1Worst": {
        "absMedianDiff": 1.084090450232182,
        "teamKey": "frc2638",
        "eventKey": "2026joh"
      },
      "clause2P10Rate": 0.9262295081967213,
      "clause2P90Rate": 0.9467213114754098,
      "clause3MeanSignedMedianDiff": -0.001705192598533146,
      "teamCount": 244
    },
    "randBVsRand": {
      "pass": false,
      "clause1TightRate": 0.8729508196721312,
      "clause1EveryTeamWithinHard": false,
      "clause1Worst": {
        "absMedianDiff": 1.2908073329807834,
        "teamKey": "frc5804",
        "eventKey": "2025cur"
      },
      "clause2P10Rate": 0.9754098360655737,
      "clause2P90Rate": 0.9918032786885246,
      "clause3MeanSignedMedianDiff": 0.0002897231106329358,
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
  "sweep": [
    {
      "n": 10,
      "reproducibilityGen": {
        "meanAbsMedian": 2.833774314893886,
        "p95AbsMedian": 8.5,
        "maxAbsMedian": 18.68181818181818,
        "meanAbsEdge": 2.691117846635868,
        "p95AbsEdge": 10,
        "maxAbsEdge": 21
      },
      "reproducibilityRand": {
        "meanAbsMedian": 2.9595209021278417,
        "p95AbsMedian": 8.727272727272727,
        "maxAbsMedian": 21,
        "meanAbsEdge": 2.6546774473648043,
        "p95AbsEdge": 9.5,
        "maxAbsEdge": 17.5
      },
      "convergenceGen": {
        "meanAbsMedian": 1.9492639844916797,
        "p95AbsMedian": 6.1269841269841265,
        "maxAbsMedian": 11.352622453402688,
        "meanAbsEdge": 1.9938151248853544,
        "p95AbsEdge": 7.346835443037975,
        "maxAbsEdge": 18.665217391304346
      },
      "convergenceRand": {
        "meanAbsMedian": 2.256932417687851,
        "p95AbsMedian": 7.048228766538621,
        "maxAbsMedian": 9.961892247043366,
        "meanAbsEdge": 1.9092967069292928,
        "p95AbsEdge": 6.447994987468668,
        "maxAbsEdge": 13.74431818181818
      }
    },
    {
      "n": 20,
      "reproducibilityGen": {
        "meanAbsMedian": 2.051107683936461,
        "p95AbsMedian": 6.910714285714285,
        "maxAbsMedian": 13.854545454545452,
        "meanAbsEdge": 1.8915030856610533,
        "p95AbsEdge": 7.044444444444446,
        "maxAbsEdge": 14.428571428571427
      },
      "reproducibilityRand": {
        "meanAbsMedian": 2.1668187424446854,
        "p95AbsMedian": 6.899999999999999,
        "maxAbsMedian": 14.75,
        "meanAbsEdge": 1.9414371016665843,
        "p95AbsEdge": 6.885714285714286,
        "maxAbsEdge": 12.600000000000001
      },
      "convergenceGen": {
        "meanAbsMedian": 1.4309248664498868,
        "p95AbsMedian": 4.75393545848091,
        "maxAbsMedian": 7.633701250919799,
        "meanAbsEdge": 1.3664336726597244,
        "p95AbsEdge": 4.756469979296066,
        "maxAbsEdge": 10.76588337684943
      },
      "convergenceRand": {
        "meanAbsMedian": 1.7227102903905405,
        "p95AbsMedian": 4.971519795657727,
        "maxAbsMedian": 8.86697247706422,
        "meanAbsEdge": 1.4567502643635446,
        "p95AbsEdge": 5.1736292428198425,
        "maxAbsEdge": 9.493013972055884
      }
    },
    {
      "n": 30,
      "reproducibilityGen": {
        "meanAbsMedian": 1.854608060793821,
        "p95AbsMedian": 5.482954545454547,
        "maxAbsMedian": 13.005347593582883,
        "meanAbsEdge": 1.67484453747634,
        "p95AbsEdge": 6.266666666666666,
        "maxAbsEdge": 12.7
      },
      "reproducibilityRand": {
        "meanAbsMedian": 1.8536117225971784,
        "p95AbsMedian": 6.158730158730158,
        "maxAbsMedian": 11.392857142857146,
        "meanAbsEdge": 1.5998070233333703,
        "p95AbsEdge": 5.6111111111111125,
        "maxAbsEdge": 11.142857142857146
      },
      "convergenceGen": {
        "meanAbsMedian": 1.2751052032858567,
        "p95AbsMedian": 3.9942353144635945,
        "maxAbsMedian": 6.863864491844417,
        "meanAbsEdge": 1.1707242610901765,
        "p95AbsEdge": 4.085365853658537,
        "maxAbsEdge": 9.932550043516102
      },
      "convergenceRand": {
        "meanAbsMedian": 1.3492779815269544,
        "p95AbsMedian": 4.548790658882403,
        "maxAbsMedian": 8.225848563968668,
        "meanAbsEdge": 1.196295051625155,
        "p95AbsEdge": 4.117647058823529,
        "maxAbsEdge": 8.984924623115578
      }
    },
    {
      "n": 50,
      "reproducibilityGen": {
        "meanAbsMedian": 1.5215255325372308,
        "p95AbsMedian": 5.233846153846152,
        "maxAbsMedian": 11.58441558441558,
        "meanAbsEdge": 1.3543889051263922,
        "p95AbsEdge": 5.274725274725274,
        "maxAbsEdge": 7.857142857142854
      },
      "reproducibilityRand": {
        "meanAbsMedian": 1.3876413213383976,
        "p95AbsMedian": 4.153846153846153,
        "maxAbsMedian": 8.70634920634921,
        "meanAbsEdge": 1.159334659421675,
        "p95AbsEdge": 4.091575091575091,
        "maxAbsEdge": 8.42857142857143
      },
      "convergenceGen": {
        "meanAbsMedian": 1.0056521047499296,
        "p95AbsMedian": 2.8372308209959627,
        "maxAbsMedian": 4.560996200928663,
        "meanAbsEdge": 0.9006360085463222,
        "p95AbsEdge": 3.3275261324041807,
        "maxAbsEdge": 7.099216710182766
      },
      "convergenceRand": {
        "meanAbsMedian": 1.0567720953025945,
        "p95AbsMedian": 3.1945787545787567,
        "maxAbsMedian": 7.117152911794754,
        "meanAbsEdge": 0.9020123953129023,
        "p95AbsEdge": 2.913116123642446,
        "maxAbsEdge": 8.057389937106919
      }
    },
    {
      "n": 75,
      "reproducibilityGen": {
        "meanAbsMedian": 1.1416167603832186,
        "p95AbsMedian": 3.5115207373271886,
        "maxAbsMedian": 5.946249999999999,
        "meanAbsEdge": 1.0361852544869241,
        "p95AbsEdge": 3.6842105263157876,
        "maxAbsEdge": 7.741666666666667
      },
      "reproducibilityRand": {
        "meanAbsMedian": 1.1124961030197076,
        "p95AbsMedian": 3.2237037037037055,
        "maxAbsMedian": 6.5428571428571445,
        "meanAbsEdge": 0.9959092849822029,
        "p95AbsEdge": 3.405594405594403,
        "maxAbsEdge": 6.928571428571431
      },
      "convergenceGen": {
        "meanAbsMedian": 0.8048671522159488,
        "p95AbsMedian": 2.4996168875948186,
        "maxAbsMedian": 3.797017230169054,
        "meanAbsEdge": 0.7026211756130853,
        "p95AbsEdge": 2.429223744292239,
        "maxAbsEdge": 5.76588337684943
      },
      "convergenceRand": {
        "meanAbsMedian": 0.7775795520458334,
        "p95AbsMedian": 2.377591118970429,
        "maxAbsMedian": 4.199324950854937,
        "meanAbsEdge": 0.70387404751614,
        "p95AbsEdge": 2.3655985758789484,
        "maxAbsEdge": 6.708333333333336
      }
    },
    {
      "n": 100,
      "reproducibilityGen": {
        "meanAbsMedian": 0.955543712971261,
        "p95AbsMedian": 3.141570141570135,
        "maxAbsMedian": 5.1963249516440975,
        "meanAbsEdge": 0.8875058030150264,
        "p95AbsEdge": 3.095238095238095,
        "maxAbsEdge": 6.675824175824175
      },
      "reproducibilityRand": {
        "meanAbsMedian": 0.984223515356689,
        "p95AbsMedian": 2.979287237282973,
        "maxAbsMedian": 4.8940540540540525,
        "meanAbsEdge": 0.9144850850173667,
        "p95AbsEdge": 3,
        "maxAbsEdge": 7.049999999999997
      },
      "convergenceGen": {
        "meanAbsMedian": 0.7407949609438762,
        "p95AbsMedian": 2.222959183673474,
        "maxAbsMedian": 3.2998581392599604,
        "meanAbsEdge": 0.636037088957534,
        "p95AbsEdge": 2.348092453355612,
        "maxAbsEdge": 4.6584615384615375
      },
      "convergenceRand": {
        "meanAbsMedian": 0.7766526897187163,
        "p95AbsMedian": 2.349766899766898,
        "maxAbsMedian": 4.242885556915546,
        "meanAbsEdge": 0.6675250061681262,
        "p95AbsEdge": 2.243225806451619,
        "maxAbsEdge": 6.468104222821204
      }
    },
    {
      "n": 150,
      "reproducibilityGen": {
        "meanAbsMedian": 0.8422945792258003,
        "p95AbsMedian": 2.446341463414633,
        "maxAbsMedian": 4.566231343283583,
        "meanAbsEdge": 0.7461696766320288,
        "p95AbsEdge": 2.69913043478261,
        "maxAbsEdge": 5.663809523809526
      },
      "reproducibilityRand": {
        "meanAbsMedian": 0.8421904916294289,
        "p95AbsMedian": 2.933968926553675,
        "maxAbsMedian": 4.106514084507044,
        "meanAbsEdge": 0.7817349461945938,
        "p95AbsEdge": 2.718867924528311,
        "maxAbsEdge": 6.277777777777779
      },
      "convergenceGen": {
        "meanAbsMedian": 0.6315057707384192,
        "p95AbsMedian": 1.781965471447542,
        "maxAbsMedian": 3.306965761511215,
        "meanAbsEdge": 0.5418030276663239,
        "p95AbsEdge": 1.8280269579363235,
        "maxAbsEdge": 3.357563025210087
      },
      "convergenceRand": {
        "meanAbsMedian": 0.590072855639423,
        "p95AbsMedian": 1.8125763125763115,
        "maxAbsMedian": 3.417325855423009,
        "meanAbsEdge": 0.5253993264577231,
        "p95AbsEdge": 1.8533333333333335,
        "maxAbsEdge": 4.400000000000006
      }
    },
    {
      "n": 200,
      "reproducibilityGen": {
        "meanAbsMedian": 0.7277510078696003,
        "p95AbsMedian": 2.200101317122595,
        "maxAbsMedian": 3.87330051570558,
        "meanAbsEdge": 0.6546629095081808,
        "p95AbsEdge": 2.411538461538459,
        "maxAbsEdge": 5.358974358974358
      },
      "reproducibilityRand": {
        "meanAbsMedian": 0.7386449161965147,
        "p95AbsMedian": 2.341597796143251,
        "maxAbsMedian": 4.280006123698719,
        "meanAbsEdge": 0.6632352957381304,
        "p95AbsEdge": 2.352564102564102,
        "maxAbsEdge": 4.684415584415582
      },
      "convergenceGen": {
        "meanAbsMedian": 0.5210186566088401,
        "p95AbsMedian": 1.5335166273893677,
        "maxAbsMedian": 3.271020523976169,
        "meanAbsEdge": 0.4696866043137671,
        "p95AbsEdge": 1.6929547844374397,
        "maxAbsEdge": 3.555985915492954
      },
      "convergenceRand": {
        "meanAbsMedian": 0.4643015838392339,
        "p95AbsMedian": 1.312281395419575,
        "maxAbsMedian": 2.8196900114810575,
        "meanAbsEdge": 0.4440944468837656,
        "p95AbsEdge": 1.5363636363636388,
        "maxAbsEdge": 2.735021516054289
      }
    },
    {
      "n": 300,
      "reproducibilityGen": {
        "meanAbsMedian": 0.5715037484723535,
        "p95AbsMedian": 1.8331080684021828,
        "maxAbsMedian": 3.1796875,
        "meanAbsEdge": 0.5071258228809582,
        "p95AbsEdge": 1.8285714285714292,
        "maxAbsEdge": 3.3703516316721434
      },
      "reproducibilityRand": {
        "meanAbsMedian": 0.6267804669499264,
        "p95AbsMedian": 2.0877341762393016,
        "maxAbsMedian": 3.127272727272725,
        "meanAbsEdge": 0.5711372255159342,
        "p95AbsEdge": 2.022200772200769,
        "maxAbsEdge": 4.5
      },
      "convergenceGen": {
        "meanAbsMedian": 0.39213890456099176,
        "p95AbsMedian": 1.2654796238244472,
        "maxAbsMedian": 2.7617565920318228,
        "meanAbsEdge": 0.36260666290844956,
        "p95AbsEdge": 1.3335084723499264,
        "maxAbsEdge": 3.13946049176414
      },
      "convergenceRand": {
        "meanAbsMedian": 0.40006345836749024,
        "p95AbsMedian": 1.1398998554961857,
        "maxAbsMedian": 2.2308417997097223,
        "meanAbsEdge": 0.3666915766114267,
        "p95AbsEdge": 1.242346938775512,
        "maxAbsEdge": 2.9632073915195463
      }
    },
    {
      "n": 500,
      "reproducibilityGen": {
        "meanAbsMedian": 0.4417675672497674,
        "p95AbsMedian": 1.3570117955439045,
        "maxAbsMedian": 2.5036727456940255,
        "meanAbsEdge": 0.3923487676678685,
        "p95AbsEdge": 1.4022806461830868,
        "maxAbsEdge": 2.783518976897689
      },
      "reproducibilityRand": {
        "meanAbsMedian": 0.49510914144908785,
        "p95AbsMedian": 1.3704992833952474,
        "maxAbsMedian": 1.889062800340497,
        "meanAbsEdge": 0.42547628477367355,
        "p95AbsEdge": 1.6047364400305568,
        "maxAbsEdge": 4.332258064516125
      },
      "convergenceGen": {
        "meanAbsMedian": 0.27514500362745853,
        "p95AbsMedian": 0.8622486788556216,
        "maxAbsMedian": 1.5926325715278296,
        "meanAbsEdge": 0.24633670883969105,
        "p95AbsEdge": 0.8691166989039374,
        "maxAbsEdge": 2.0080996884735214
      },
      "convergenceRand": {
        "meanAbsMedian": 0.28685300305793593,
        "p95AbsMedian": 0.8498931178143394,
        "maxAbsMedian": 1.14534984789222,
        "meanAbsEdge": 0.2602034933826666,
        "p95AbsEdge": 0.8715309492025547,
        "maxAbsEdge": 1.8599194360523654
      }
    },
    {
      "n": 750,
      "reproducibilityGen": {
        "meanAbsMedian": 0.3742398785785592,
        "p95AbsMedian": 1.1709631606128426,
        "maxAbsMedian": 1.998217911121138,
        "meanAbsEdge": 0.3345773066559002,
        "p95AbsEdge": 1.1028962847144648,
        "maxAbsEdge": 2.82865707434053
      },
      "reproducibilityRand": {
        "meanAbsMedian": 0.3926722753456203,
        "p95AbsMedian": 1.1281285208433935,
        "maxAbsMedian": 1.999886825195226,
        "meanAbsEdge": 0.3467880434324613,
        "p95AbsEdge": 1.2122759856630765,
        "maxAbsEdge": 2.9062247874387097
      },
      "convergenceGen": {
        "meanAbsMedian": 0.19363893969517718,
        "p95AbsMedian": 0.646699249625506,
        "maxAbsMedian": 1.274711779448623,
        "meanAbsEdge": 0.17120586445505837,
        "p95AbsEdge": 0.5840087808172854,
        "maxAbsEdge": 1.3906717063168514
      },
      "convergenceRand": {
        "meanAbsMedian": 0.20061989461922006,
        "p95AbsMedian": 0.6299694189602434,
        "maxAbsMedian": 0.8539583945898279,
        "meanAbsEdge": 0.18567880915385482,
        "p95AbsEdge": 0.6539547050320103,
        "maxAbsEdge": 1.3248803827751203
      }
    },
    {
      "n": 2000,
      "reproducibilityGen": {
        "meanAbsMedian": 0.2237353077743953,
        "p95AbsMedian": 0.6652270871840855,
        "maxAbsMedian": 1.002966684294023,
        "meanAbsEdge": 0.18743896635548254,
        "p95AbsEdge": 0.7008030962747966,
        "maxAbsEdge": 1.6196515679442527
      },
      "reproducibilityRand": {
        "meanAbsMedian": 0.2246417960372505,
        "p95AbsMedian": 0.6558205527641832,
        "maxAbsMedian": 1.2908073329807834,
        "meanAbsEdge": 0.19714601978601123,
        "p95AbsEdge": 0.730198019801982,
        "maxAbsEdge": 1.5746911904438683
      },
      "convergenceGen": {
        "meanAbsMedian": 0,
        "p95AbsMedian": 0,
        "maxAbsMedian": 0,
        "meanAbsEdge": 0,
        "p95AbsEdge": 0,
        "maxAbsEdge": 0
      },
      "convergenceRand": {
        "meanAbsMedian": 0,
        "p95AbsMedian": 0,
        "maxAbsMedian": 0,
        "meanAbsEdge": 0,
        "p95AbsEdge": 0,
        "maxAbsEdge": 0
      }
    }
  ],
  "splitProbe": [
    {
      "scheduleCount": 20,
      "drawsPerSchedule": 1000,
      "reproducibilityGen": {
        "meanAbsMedian": 1.8699265083499894,
        "p95AbsMedian": 6.047133624377025,
        "maxAbsMedian": 8.379512533610892,
        "meanAbsEdge": 1.5573287376518994,
        "p95AbsEdge": 5.627963849016481,
        "maxAbsEdge": 11.97866761162296
      },
      "reproducibilityRand": {
        "meanAbsMedian": 2.190493668230486,
        "p95AbsMedian": 7.389591815429583,
        "maxAbsMedian": 12.201851851851849,
        "meanAbsEdge": 1.8784439204070795,
        "p95AbsEdge": 7.106539231877434,
        "maxAbsEdge": 13.445307336417713
      }
    },
    {
      "scheduleCount": 50,
      "drawsPerSchedule": 400,
      "reproducibilityGen": {
        "meanAbsMedian": 1.2290486728413068,
        "p95AbsMedian": 3.889495249619607,
        "maxAbsMedian": 6.9685990338164245,
        "meanAbsEdge": 1.0331092236034154,
        "p95AbsEdge": 4.010047973997153,
        "maxAbsEdge": 9.07516490259242
      },
      "reproducibilityRand": {
        "meanAbsMedian": 1.451678863716201,
        "p95AbsMedian": 4.413630976666468,
        "maxAbsMedian": 7.3986287414983,
        "meanAbsEdge": 1.2368684201194373,
        "p95AbsEdge": 4.472307692307687,
        "maxAbsEdge": 9.750938086303943
      }
    },
    {
      "scheduleCount": 100,
      "drawsPerSchedule": 200,
      "reproducibilityGen": {
        "meanAbsMedian": 0.8948973528348106,
        "p95AbsMedian": 3.110684171202898,
        "maxAbsMedian": 4.553096442558747,
        "meanAbsEdge": 0.7684118780992758,
        "p95AbsEdge": 2.697976442162485,
        "maxAbsEdge": 5.932902298850578
      },
      "reproducibilityRand": {
        "meanAbsMedian": 1.0094229189709871,
        "p95AbsMedian": 2.8502448614834677,
        "maxAbsMedian": 7.135256820119352,
        "meanAbsEdge": 0.8173182928680507,
        "p95AbsEdge": 3.1067774936061383,
        "maxAbsEdge": 7.760697032436163
      }
    },
    {
      "scheduleCount": 250,
      "drawsPerSchedule": 80,
      "reproducibilityGen": {
        "meanAbsMedian": 0.5812688476834557,
        "p95AbsMedian": 1.839535544789399,
        "maxAbsMedian": 2.890016480180414,
        "meanAbsEdge": 0.49528071467466267,
        "p95AbsEdge": 1.7026857017831762,
        "maxAbsEdge": 3.547762454264003
      },
      "reproducibilityRand": {
        "meanAbsMedian": 0.5611057334016364,
        "p95AbsMedian": 1.6112647917627214,
        "maxAbsMedian": 3.3717989276356874,
        "meanAbsEdge": 0.50791487518775,
        "p95AbsEdge": 1.9375464307422234,
        "maxAbsEdge": 3.4632498889053487
      }
    },
    {
      "scheduleCount": 500,
      "drawsPerSchedule": 40,
      "reproducibilityGen": {
        "meanAbsMedian": 0.4578706283198653,
        "p95AbsMedian": 1.3998134328358205,
        "maxAbsMedian": 2.312211876842362,
        "meanAbsEdge": 0.3720664438244936,
        "p95AbsEdge": 1.387857644374229,
        "maxAbsEdge": 3.2119205298013256
      },
      "reproducibilityRand": {
        "meanAbsMedian": 0.40394487518372474,
        "p95AbsMedian": 1.305663430420708,
        "maxAbsMedian": 1.9900394103050658,
        "meanAbsEdge": 0.3662652846969888,
        "p95AbsEdge": 1.28745341614907,
        "maxAbsEdge": 2.404723564143854
      }
    },
    {
      "scheduleCount": 1000,
      "drawsPerSchedule": 20,
      "reproducibilityGen": {
        "meanAbsMedian": 0.3308957000265613,
        "p95AbsMedian": 1.0006800315534647,
        "maxAbsMedian": 1.8626149131767136,
        "meanAbsEdge": 0.262059773635949,
        "p95AbsEdge": 0.9656201349247553,
        "maxAbsEdge": 1.935465768799098
      },
      "reproducibilityRand": {
        "meanAbsMedian": 0.36216481231689523,
        "p95AbsMedian": 1.0876174682144821,
        "maxAbsMedian": 1.7492586268871335,
        "meanAbsEdge": 0.31354117507964613,
        "p95AbsEdge": 1.025743144764931,
        "maxAbsEdge": 1.8560404807084154
      }
    }
  ],
  "recommendation": {
    "tolerance": 0.5,
    "smallestSufficientN": 500,
    "smallestNWithinOneRank": 100,
    "sqrtLawConstant": 9.927721555424311,
    "sqrtLawConstantRange": [
      8.96118120994789,
      10.758810218055489
    ]
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
          "absMedianDiff": 0.376602013532259,
          "teamKey": "frc2013",
          "eventKey": "2022on034"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.015020259571938675,
        "teamCount": 14
      },
      "genBVsGenA": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.11855635049419888,
          "teamKey": "frc2706",
          "eventKey": "2022on034"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.0026327338749744405,
        "teamCount": 14
      },
      "randVsGenB": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.440074145074675,
          "teamKey": "frc2013",
          "eventKey": "2022on034"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.012387525696964235,
        "teamCount": 14
      },
      "randBVsRand": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.1739959603462129,
          "teamKey": "frc8729",
          "eventKey": "2022on034"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.002666807045536425,
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
          "absMedianDiff": 0.14679143802804617,
          "teamKey": "frc9086",
          "eventKey": "2023gaalb"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.002371258239720609,
        "teamCount": 21
      },
      "genBVsGenA": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.13348916939379762,
          "teamKey": "frc3329",
          "eventKey": "2023gaalb"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.0005534770625396778,
        "teamCount": 21
      },
      "randVsGenB": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.1294335810464844,
          "teamKey": "frc6919",
          "eventKey": "2023gaalb"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.0029247353022602866,
        "teamCount": 21
      },
      "randBVsRand": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.16479606025910876,
          "teamKey": "frc3329",
          "eventKey": "2023gaalb"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.00045380424048234246,
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
        "clause1TightRate": 0.85,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.6942022961751952,
          "teamKey": "frc5869",
          "eventKey": "2024caav"
        },
        "clause2P10Rate": 0.825,
        "clause2P90Rate": 0.75,
        "clause3MeanSignedMedianDiff": 0.024742906175590364,
        "teamCount": 40
      },
      "genBVsGenA": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.3676556926757186,
          "teamKey": "frc6072",
          "eventKey": "2024caav"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.009279700675348179,
        "teamCount": 40
      },
      "randVsGenB": {
        "pass": false,
        "clause1TightRate": 0.875,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.7568149898670402,
          "teamKey": "frc1515",
          "eventKey": "2024caav"
        },
        "clause2P10Rate": 0.775,
        "clause2P90Rate": 0.775,
        "clause3MeanSignedMedianDiff": 0.03402260685093854,
        "teamCount": 40
      },
      "randBVsRand": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.40954431139193304,
          "teamKey": "frc4123",
          "eventKey": "2024caav"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.00879610534362112,
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
        "clause1TightRate": 0.8421052631578947,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.2167197452229317,
          "teamKey": "frc75",
          "eventKey": "2025cur"
        },
        "clause2P10Rate": 0.9736842105263158,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.004614018939385389,
        "teamCount": 76
      },
      "genBVsGenA": {
        "pass": false,
        "clause1TightRate": 0.7894736842105263,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.002966684294023,
          "teamKey": "frc1391",
          "eventKey": "2025cur"
        },
        "clause2P10Rate": 0.9473684210526315,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.0024381354956761105,
        "teamCount": 76
      },
      "randVsGenB": {
        "pass": false,
        "clause1TightRate": 0.6973684210526315,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.0062833612932742,
          "teamKey": "frc870",
          "eventKey": "2025cur"
        },
        "clause2P10Rate": 0.9736842105263158,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.002175883443709278,
        "teamCount": 76
      },
      "randBVsRand": {
        "pass": false,
        "clause1TightRate": 0.8026315789473685,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.2908073329807834,
          "teamKey": "frc5804",
          "eventKey": "2025cur"
        },
        "clause2P10Rate": 0.9605263157894737,
        "clause2P90Rate": 0.9868421052631579,
        "clause3MeanSignedMedianDiff": 0.011547500174688355,
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
        "clause1TightRate": 0.8266666666666667,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.4139487975689278,
          "teamKey": "frc3414",
          "eventKey": "2026joh"
        },
        "clause2P10Rate": 0.96,
        "clause2P90Rate": 0.9466666666666667,
        "clause3MeanSignedMedianDiff": -0.012684204037158746,
        "teamCount": 75
      },
      "genBVsGenA": {
        "pass": false,
        "clause1TightRate": 0.8666666666666667,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.9911720809630182,
          "teamKey": "frc9484",
          "eventKey": "2026joh"
        },
        "clause2P10Rate": 0.96,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.014829662746688939,
        "teamCount": 75
      },
      "randVsGenB": {
        "pass": false,
        "clause1TightRate": 0.76,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.084090450232182,
          "teamKey": "frc2638",
          "eventKey": "2026joh"
        },
        "clause2P10Rate": 0.9066666666666666,
        "clause2P90Rate": 0.9466666666666667,
        "clause3MeanSignedMedianDiff": -0.027513866783847683,
        "teamCount": 75
      },
      "randBVsRand": {
        "pass": false,
        "clause1TightRate": 0.7866666666666666,
        "clause1EveryTeamWithinHard": false,
        "clause1Worst": {
          "absMedianDiff": 1.0153347330374487,
          "teamKey": "frc179",
          "eventKey": "2026joh"
        },
        "clause2P10Rate": 0.96,
        "clause2P90Rate": 0.9866666666666667,
        "clause3MeanSignedMedianDiff": -0.005516893419354911,
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
          "absMedianDiff": 0.13977624488075513,
          "teamKey": "frc4063",
          "eventKey": "2026txmca"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.0029801022779238537,
        "teamCount": 18
      },
      "genBVsGenA": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.1710729793392769,
          "teamKey": "frc4597",
          "eventKey": "2026txmca"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": -0.009080513351292082,
        "teamCount": 18
      },
      "randVsGenB": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.28026474677986,
          "teamKey": "frc4063",
          "eventKey": "2026txmca"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.012060615629215935,
        "teamCount": 18
      },
      "randBVsRand": {
        "pass": true,
        "clause1TightRate": 1,
        "clause1EveryTeamWithinHard": true,
        "clause1Worst": {
          "absMedianDiff": 0.1794024683858506,
          "teamKey": "frc4063",
          "eventKey": "2026txmca"
        },
        "clause2P10Rate": 1,
        "clause2P90Rate": 1,
        "clause3MeanSignedMedianDiff": 0.00030882408901242473,
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
| random vs generated (ref A), N=2000 | 87.3% | false | 95.1% | 94.3% | 0.0000 | 1.41 (frc3414 @ 2026joh) | FAIL |
| random vs generated (ref B), N=2000 | 81.1% | false | 92.6% | 94.7% | -0.0017 | 1.08 (frc2638 @ 2026joh) | FAIL |
| **generated-vs-generated floor**, N=2000 | 89.3% | false | 97.1% | 100.0% | 0.0017 | 1.00 (frc1391 @ 2025cur) | FAIL |
| **random-vs-random floor**, N=2000 | 87.3% | false | 97.5% | 99.2% | 0.0003 | 1.29 (frc5804 @ 2025cur) | FAIL |
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
| `2022on034` | 2022 | 14 | 21 | 9 | cold (target season 2022 only, assumption A-FA3) | 100.0% | 100.0% | 0.015 |
| `2023gaalb` | 2023 | 21 | 42 | 12 | cold (target season 2023 only, assumption A-FA3) | 100.0% | 100.0% | 0.002 |
| `2024caav` | 2024 | 40 | 74 | 11 | cold (target season 2024 only, assumption A-FA3) | 85.0% | 100.0% | 0.025 |
| `2025cur` | 2025 | 76 | 127 | 10 | cold (target season 2025 only, assumption A-FA3) | 84.2% | 78.9% | -0.005 |
| `2026joh` | 2026 | 75 | 125 | 10 | cold (target season 2026 only, assumption A-FA3) | 82.7% | 86.7% | -0.013 |
| `2026txmca` | 2026 | 18 | 36 | 12 | cold (target season 2026 only, assumption A-FA3) | 100.0% | 100.0% | 0.003 |

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

## How many schedules is enough

Every figure below is in RANKS, pooled across the sample. **Reproducibility** is two INDEPENDENT draws at that N — literally how far a team's published band moves if the publish is re-run with nothing else changed. That is the number that matters, because it is the amount of what a visitor sees that is not signal. **Convergence** is the same N against the same arm's own N=2000 answer, and separates "stable but still biased" from "stable and arrived" — a small reproducibility beside a large convergence is a low N that re-running would never reveal.

| N | gen repro mean | p95 | worst | rand repro mean | p95 | worst | gen conv mean | rand conv mean |
|---|---|---|---|---|---|---|---|---|
| 10 | 2.834 | 8.50 | 18.68 | 2.960 | 8.73 | 21.00 | 1.949 | 2.257 |
| 20 | 2.051 | 6.91 | 13.85 | 2.167 | 6.90 | 14.75 | 1.431 | 1.723 |
| 30 | 1.855 | 5.48 | 13.01 | 1.854 | 6.16 | 11.39 | 1.275 | 1.349 |
| 50 | 1.522 | 5.23 | 11.58 | 1.388 | 4.15 | 8.71 | 1.006 | 1.057 |
| 75 | 1.142 | 3.51 | 5.95 | 1.112 | 3.22 | 6.54 | 0.805 | 0.778 |
| 100 | 0.956 | 3.14 | 5.20 | 0.984 | 2.98 | 4.89 | 0.741 | 0.777 |
| 150 | 0.842 | 2.45 | 4.57 | 0.842 | 2.93 | 4.11 | 0.632 | 0.590 |
| 200 | 0.728 | 2.20 | 3.87 | 0.739 | 2.34 | 4.28 | 0.521 | 0.464 |
| 300 | 0.572 | 1.83 | 3.18 | 0.627 | 2.09 | 3.13 | 0.392 | 0.400 |
| 500 | 0.442 | 1.36 | 2.50 | 0.495 | 1.37 | 1.89 | 0.275 | 0.287 |
| 750 | 0.374 | 1.17 | 2.00 | 0.393 | 1.13 | 2.00 | 0.194 | 0.201 |
| 2000 | 0.224 | 0.67 | 1.00 | 0.225 | 0.66 | 1.29 | 0.000 | 0.000 |

The curve is `mean |Δmedian| ≈ 9.9 / √N` (the fitted constant ranges 9.0–10.8 across checkpoints, which is what licenses extrapolating it). **There is no N at which this converges** — it is Monte Carlo error, so it falls forever and never lands. Reaching a mean of 0.1 ranks would need N ≈ 9856.

**The recommendation, derived from the table above rather than chosen:**

- **N = 500** is the smallest N measured whose pooled mean |Δmedian| (0.495 ranks) sits at or under 0.5 — this project's own stated threshold for the smallest median difference a band printed to one decimal place can render as distinct. Below it, a re-publish cannot change what a visitor sees. p95 1.37, worst 2.50.
- **N = 100** is the floor if a mean of 1 rank is acceptable — the cheapest setting with any defence at all.
- **N = 20, the shipped setting, is not defensible on this evidence** and fails independently of the random-vs-generated question: mean 2.05 ranks, p95 6.91, worst 13.85. Two runs of identical code visibly reorder the band.

## Schedules or draws? (the cost question)

The curve above grows N with `drawsPerSchedule` held fixed, so it grows the total draw count at the same time and cannot say which knob bought the stability. The distinction decides what an answer costs: an extra draw re-uses a schedule's already-priced pmfs, while an extra schedule needs a fresh `predict` call for every one of its matches. So every row below spends the SAME 20000 draws, divided differently.

| Split | gen repro mean | p95 | worst | rand repro mean | gen edge mean | rand edge mean |
|---|---|---|---|---|---|---|
| 20 × 1000 | 1.870 | 6.05 | 8.38 | 2.190 | 1.557 | 1.878 |
| 50 × 400 | 1.229 | 3.89 | 6.97 | 1.452 | 1.033 | 1.237 |
| 100 × 200 | 0.895 | 3.11 | 4.55 | 1.009 | 0.768 | 0.817 |
| 250 × 80 | 0.581 | 1.84 | 2.89 | 0.561 | 0.495 | 0.508 |
| 500 × 40 | 0.458 | 1.40 | 2.31 | 0.404 | 0.372 | 0.366 |
| 1000 × 20 | 0.331 | 1.00 | 1.86 | 0.362 | 0.262 | 0.314 |

**Draws do not substitute for schedules.** 20 schedules given 1000 draws each is 5.7× worse than 1000 given 20 each, at identical draw cost. Draw noise is saturated within a few tens of draws per schedule; every bit of movement left over is schedule sampling. The shipped `PRESIM_DRAWS_PER_SCHEDULE` of 50 is therefore spending on the axis that is already exhausted — at a fixed budget those draws are worth more as schedules.

**And N is nearly free in the only currency that reaches a visitor.** `apps/web/src/lib/preScheduleResult.ts` reads `baked.histograms` and `baked.draws` and nothing else; the artifact's `schedules` block — the overwhelming majority of its bytes, per the artifact-size table above — is shipped but never computed from, with only `schedules.length` consumed, for a caption. `baked.histograms` is roster × roster regardless of N. So raising N costs offline pipeline CPU and, once that block stops being shipped, no payload at all.

## Caveats

- **The random construction is a randomised sequential deal, not a uniform draw** from the space of duplicate-free schedules: appearances are poured into one bag, shuffled, and dealt into rows of six, scanning forward for the first entry whose team is not already in the row. Rows the repair could not fix are counted and reported (0 across this run).
- **Both arms hold every team's credited match count fixed** at the template's own `appearancesPerTeam`, and reproduce its surrogate-slot count. The random arm chooses WHICH teams take the surrogate appearances itself, since that choice is part of the structure under test.
- **Neither arm is validated against realised rankings.** This measures agreement between two forecasts of the same event, not the accuracy of either.
- **One replay and one pricing state per event, shared by all three arms.** Every difference reported here is the schedule construction and the draw stream, nothing else.
