(function () {
  const atomicMasses = {
    H: 1.00782503223,
    D: 2.01410177812,
    He: 4.00260325415,
    Li: 7.0160034366,
    Be: 9.012183065,
    B: 11.00930536,
    C: 12.0,
    N: 14.00307400443,
    O: 15.99491461957,
    F: 18.998403163,
    Ne: 19.9924401754,
    Na: 22.989769282,
    Mg: 23.985041697,
    Al: 26.98153853,
    Si: 27.9769265359,
    P: 30.973761998,
    S: 31.9720711744,
    Cl: 34.968852682,
    Ar: 39.9623831237,
    K: 38.9637064864,
    Ca: 39.96259098,
    Sc: 44.95590828,
    Ti: 47.94794198,
    V: 50.9439595,
    Cr: 51.94050623,
    Mn: 54.93804391,
    Fe: 55.9349375,
    Co: 58.93319429,
    Ni: 57.9353429,
    Cu: 62.92959772,
    Zn: 63.92914201,
    Ga: 68.9255735,
    Ge: 73.921177761,
    As: 74.921595,
    Se: 73.922475,
    Br: 78.9183376,
    Kr: 83.911507,
    Rb: 84.911789737,
    Sr: 87.9056125,
    Y: 88.9058403,
    Zr: 89.9046977,
    Nb: 92.9063781,
    Mo: 97.9054073,
    Tc: 98,
    Ru: 101.904349,
    Rh: 102.9055,
    Pd: 105.90348,
    Ag: 106.905095,
    Cd: 113.90336509,
    In: 114.903878,
    Sn: 119.9021966,
    Sb: 120.9038157,
    Te: 129.9062228,
    I: 126.9044719,
    Xe: 131.9041535,
    Cs: 132.90545196,
    Ba: 137.905247,
    La: 138.9063563,
    Ce: 140.907653,
    Pr: 140.90765,
    Nd: 144.912569,
    Pm: 145,
    Sm: 151.919739,
    Eu: 152.921238,
    Gd: 157.9241039,
    Tb: 158.9253548,
    Dy: 163.9291748,
    Ho: 164.930319,
    Er: 165.930293,
    Tm: 168.9342179,
    Yb: 173.9388664,
    Lu: 174.940775,
    Hf: 179.946557,
    Ta: 180.947992,
    W: 183.95093,
    Re: 186.95575,
    Os: 191.96148,
    Ir: 192.962926,
    Pt: 194.964791,
    Au: 196.9665687,
    Hg: 201.970643,
    Tl: 204.974412,
    Pb: 207.9766521,
    Bi: 208.9803987,
    Po: 208.98243,
    At: 209.987148,
    Rn: 222.01758,
    Fr: 223,
    Ra: 226.025409,
    Ac: 227.027747,
    Th: 232.038055,
    Pa: 231.035882,
    U: 238.05078826,
    Np: 237,
    Pu: 244,
    Am: 243,
    Cm: 247,
    Bk: 247,
    Cf: 251,
    Es: 252,
    Fm: 257,
    Md: 258,
    No: 259,
    Lr: 262,
    Rf: 267,
    Db: 270,
    Sg: 271,
    Bh: 270,
    Hs: 277,
    Mt: 278,
    Ds: 281,
    Rg: 282,
    Cn: 285,
    Nh: 286,
    Fl: 289,
    Mc: 290,
    Lv: 293,
    Ts: 294,
    Og: 294,
  };

  const validAtoms = Object.keys(atomicMasses)
    .sort((a, b) => b.length - a.length)
    .join("|");
  const molecularFormulaPattern = new RegExp("^(?:(?:" + validAtoms + ")(?:\\d+)?)+$");
  const moleculeIonPattern = /\[[^\]]*\](?:\d+)?[+-](?=\s|$|:)/;

  document.addEventListener("DOMContentLoaded", function () {
    Office.onReady(function () {
      document.getElementById("analyzeButton").addEventListener("click", analyzeDocument);
    });
  });

  function analyzeDocument() {
    Word.run(function (context) {
      var body = context.document.body;
      body.load("text");
      return context.sync().then(function () {
        var text = body.text;
        var hrmsLines = extractHRMS(text);
        var out = "<h3>Detected MS Reports</h3><table style='width:100%;border-collapse:collapse;'>";
        out +=
          "<tr style='border-bottom:2px solid currentColor;'>" +
          "<th>#</th><th>Status</th><th>Net Formula</th><th>Ion</th><th>Charge</th>" +
          "<th>Exact</th><th>Written</th><th>Difference</th></tr>";
        let warnings = 0;
        let issues = 0;
        hrmsLines.forEach((entry) => {
          entry.statusIcon = getStatusIcon(entry);
          out += `<tr>
            <td><a href="#" onclick="jumpToText(event, ${entry.idx})" id="entry-${entry.idx}" style="color: inherit; text-decoration: underline;">${entry.idx}</a></td>
            <td class="tooltip-cell" data-tooltip="${getStatusTooltip(entry)}" style="text-align: center;">${entry.statusIcon}</td>
            <td>${entry.netFormula}</td>
            <td>${entry.molecularIon}</td>
            <td style="text-align: right;">${entry.netCharge}</td>
            <td style="text-align: right;">${entry.exactMz !== "N/A" ? entry.exactMz.toFixed(4) : "N/A"}</td>
            <td style="text-align: right;">${entry.expectedMz !== "N/A" ? entry.expectedMz.toFixed(4) : "N/A"}</td>
            <td style="text-align: right;">${entry.devExp !== "N/A" ? entry.devExp.toFixed(4) : "N/A"}</td>
          </tr>`;
          entry.statusIcon = getStatusIcon(entry);
          if (entry.statusIcon === "❗") {
            issues++;
          } else if (entry.statusIcon === "⚠️") {
            warnings++;
          }
        });
        out += "</table><br />";
        if (hrmsLines.length === 0) {
          out = "<p>No HRMS data found.</p>";
          document.getElementById("summary").innerHTML = "";
        } else {
          let totalEntries = hrmsLines.length;
          let warningPercent = ((warnings / totalEntries) * 100).toFixed(1);
          let issuePercent = ((issues / totalEntries) * 100).toFixed(1);
          document.getElementById("summary").innerHTML = `
          <table style="border-collapse: collapse; width: 50%;">
              <tr><th style="text-align: left;">Metric</th><th>Count</th><th> </th></tr>
              <tr><td>Total</td><td style="text-align: right;">${totalEntries}</td><td></td></tr>
              <tr><td>⚠️ (Syntax)</td><td style="text-align: right;">${warnings}</td><td style="text-align: right;">(${warningPercent}%)</td></tr>
              <tr><td>❗ (Mass Error)</td><td style="text-align: right;">${issues}</td><td style="text-align: right;">(${issuePercent}%)</td></tr>
          </table>`;
        }
        document.getElementById("results").innerHTML = out;
      });
    }).catch(function (error) {
      console.error("Error in analyzeDocument:", error);
    });
  }

  document.addEventListener("mouseover", function (event) {
    const target = event.target.closest(".tooltip-cell");
    const tooltipBox = document.getElementById("tooltip-box");
    if (target && target.dataset.tooltip) {
      tooltipBox.innerText = target.dataset.tooltip;
      tooltipBox.style.display = "block";
    }
  });

  document.addEventListener("mousemove", function (event) {
    const tooltipBox = document.getElementById("tooltip-box");
    if (tooltipBox.style.display === "block") {
      tooltipBox.style.left = event.clientX + 20 + "px";
      tooltipBox.style.top = event.clientY - 0 + "px";
    }
  });

  document.addEventListener("mouseout", function (event) {
    if (event.target.closest(".tooltip-cell")) {
      document.getElementById("tooltip-box").style.display = "none";
    }
  });

  function extractHRMS(text) {
    var pat =
      /\b(HRMS|LRMS|GCMS|MS|ESI-MS|HRESI-MS|MALDI-MS|DART-MS|DESI-MS|LCMS|EI-MS|CI-MS|FAB-MS|HR-FABMS)\b.*(\d{2,5}\.\d{3,6})/gim;
    var matches = text.match(pat) || [];
    return matches.map((line, index) => {
      line = line.replace(/:/g, "");
      let mzValues = extractMzValues(line);
      let sumFormula = extractSumFormula(line);
      let molecularIon = extractMolecularIon(line);
      let netFormula = sumFormula;
      let netCharge = extractNetCharge(molecularIon);
      let adductError = checkAdductError(netFormula, molecularIon);
      let exactMz = "N/A";
      if (netFormula !== "N/A" && netCharge !== "N/A") {
        let exactMass = computeExactMass(netFormula, netCharge);
        let absCharge = Math.abs(parseInt(netCharge));
        if (!isNaN(exactMass) && absCharge !== 0) {
          exactMz = exactMass / absCharge;
        }
      }
      return {
        idx: index + 1,
        raw: line,
        sumFormula: sumFormula,
        molecularIon: molecularIon.replace(/](.*)/, "]<sup>$1</sup>"),
        netFormula: netFormula.replace(/(\d+)/g, "<sub>$1</sub>"),
        netCharge: netCharge,
        exactMz: exactMz,
        expectedMz: mzValues.expectedMz,
        devExp: exactMz !== "N/A" && mzValues.expectedMz !== "N/A" ? exactMz - mzValues.expectedMz : "N/A",
        foundMz: mzValues.foundMz,
        diff: mzValues.expectedMz !== "N/A" && exactMz !== "N/A" ? Math.abs(mzValues.expectedMz - exactMz) : "N/A",
        adductError: adductError,
      };
    });
  }

  function extractSumFormula(line) {
    line = line.replace(/[+-]/g, "");
    var words = line.split(/\s+/).filter(Boolean);
    let bestMatch = "";
    for (var i = 0; i < words.length; i++) {
      let word = words[i].trim().replace(/[;,]/g, "");
      if (molecularFormulaPattern.test(word) && word.length > bestMatch.length) {
        bestMatch = word;
      }
    }
    return bestMatch || "N/A";
  }

  function extractMolecularIon(line) {
    var match = line.match(moleculeIonPattern);
    return match ? match[0] : "N/A";
  }

  function extractMzValues(line) {
    let floatPattern = /(\d+\.\d+)/g;
    let matches = line.match(floatPattern);
    if (matches && matches.length >= 2) {
      return { expectedMz: parseFloat(matches[matches.length - 2]), foundMz: parseFloat(matches[matches.length - 1]) };
    }
    return { expectedMz: "N/A", foundMz: "N/A" };
  }

  function extractNetCharge(moleculeIon) {
    let chargePattern = /(\d+)?([+-])$/;
    let match = chargePattern.exec(moleculeIon);
    if (!match) return "N/A";
    let netCharge = match[1] ? parseInt(match[1]) : 1;
    return match[2] === "+" ? `+${netCharge}` : `-${netCharge}`;
  }

  function computeExactMass(netFormula, netCharge) {
    let atomCounts = parseFormula(netFormula);
    let mass = Object.keys(atomCounts).reduce((acc, atom) => acc + (atomicMasses[atom] || 0) * atomCounts[atom], 0);
    return mass - parseInt(netCharge) * 0.00054858;
  }

  function parseFormula(formula) {
    let atomCounts = {};
    let atomPattern = new RegExp("(?:" + validAtoms + ")(\\d*)", "g");
    let match;
    while ((match = atomPattern.exec(formula)) !== null) {
      let atom = match[0].replace(match[1], "");
      let count = match[1] ? parseInt(match[1]) : 1;
      atomCounts[atom] = (atomCounts[atom] || 0) + count;
    }
    return atomCounts;
  }

  function checkAdductError(netFormula, molecularIon) {
    // Correct syntax requires the format: "[M]" or "[M + X]" (or multiple such groups)
    // followed by an optional numeric charge and a single charge symbol.
    // If the molecularIon does not match this pattern, mark it as a syntax error.
    const validPattern = /^\[M(?:\s+[+-]\s*[A-Za-z0-9]+)*\][0-9]*[+-]$/;
    if (!validPattern.test(molecularIon)) {
      return true;
    }
    const commonAdducts = ["Na", "K", "Li", "NH4", "Ag"];
    // If the molecularIon is just "[M]" with a charge (i.e. no adduct groups)
    // but the netFormula ends with one of the common adducts, then the adduct is probably missing.
    if (/^\[M\][0-9]*[+-]$/.test(molecularIon)) {
      for (let i = 0; i < commonAdducts.length; i++) {
        if (netFormula.endsWith(commonAdducts[i])) {
          return true;
        }
      }
    }
    return false;
  }

  function getStatusIcon(entry) {
    if (entry.adductError) return "⚠️";
    const cutoff = parseFloat(document.getElementById("cutoffInput").value) || 1.0;
    if (entry.diff !== "N/A" && entry.diff > cutoff) return "❗";
    if (entry.diff === "N/A" || entry.exactMz === "N/A" || entry.expectedMz === "N/A") return "⚠️";
    return "✅";
  }

  function getStatusTooltip(entry) {
    const commonMessages = [
      "No issues detected.",
      "Free of errors.",
      "Validated.",
      "All good.",
      "Clean.",
      "Spotless.",
      "Looks perfect.",
      "Crystal clear.",
      "Nice.",
      "Cool.",
      "Very cool.",
      "Well done.",
      "Solid.",
      "Accurate.",
      "Refined.",
      "Looks good.",
      "Polished.",
      "Professional work.",
      "Textbook.",
      "All checks passed.",
    ];
    const rareMessages = [
      "Outstanding.",
      "Very cool.",
      "Flawless.",
      "Bingo.",
      "Zero remarks.",
      "Chef’s kiss.",
      "Impeccable.",
      "Gold standard.",
      "Exactly right.",
      "As it should be.",
      "Sharp.",
      "👌",
    ];
    const ultraRareMessages = [
      "Are you even human?",
      "Perfection.",
      "This report contains exactly zero sins.",
      "This belongs in a museum.",
      "🤌",
    ];
    if (entry.statusIcon === "✅") {
      const roll = Math.random();
      if (roll < 0.01) {
        return ultraRareMessages[Math.floor(Math.random() * ultraRareMessages.length)];
      } else if (roll < 0.2) {
        return rareMessages[Math.floor(Math.random() * rareMessages.length)];
      } else {
        return commonMessages[Math.floor(Math.random() * commonMessages.length)];
      }
    }

    if (entry.statusIcon === "⚠️") {
      if (entry.molecularIon === "N/A") return "Could not parse molecular ion. Check brackets and adduct syntax.";
      if (entry.adductError) return "Possible adduct error. Did you forget the adduct in the ion?";
      if (!/^\[.*\][0-9]*[+-]$/.test(entry.molecularIon))
        return "Charges should be placed after the brackets, not inside.";
      return "Possible syntax issue in ion notation.";
    }

    if (entry.statusIcon === "❗") {
      const diff = Math.abs(entry.diff);
      const delta = diff.toFixed(4);

      const protonMass = 1.00782503223;
      const electronMass = 0.00054858;

      const absCharge = Math.abs(parseInt(entry.netCharge)) || 1;
      const protonShift = protonMass / absCharge;
      const electronShift = electronMass / absCharge;

      if (Math.abs(diff - protonShift) < 0.002) {
        return `m/z differs by ${protonShift.toFixed(5)} — did you forget or miscount a hydrogen atom for the ${entry.netCharge} ion?`;
      }

      if (Math.abs(diff - electronShift) < 0.001) {
        return `m/z differs by ${electronShift.toFixed(5)} — did you forget to subtract the electron mass for the ${entry.netCharge} ion?`;
      }

      const relError = Math.abs(entry.exactMz / entry.expectedMz - 1);
      if (relError > 0.45 && relError < 0.55) {
        return `m/z differs by ~100% — is the charge correct? (e.g. single vs. double charged ion)`;
      }

      if (diff > 5) return `Large m/z deviation (${delta}). Formula or charge likely incorrect.`;
      if (diff > 1) return `Significant m/z deviation (${delta}). Possibly wrong adduct or miscounted atoms.`;
      return `m/z deviation (${delta}) exceeds tolerance.`;
    }

    return "Issue detected.";
  }

  window.jumpToText = function (event, index) {
    event.preventDefault();
    document.querySelectorAll("a[id^='entry-']").forEach(function (el) {
      el.style.color = "inherit";
    });
    var currentLink = document.getElementById("entry-" + index);
    if (currentLink) {
      currentLink.style.color = "red";
    }
    Word.run(function (context) {
      var body = context.document.body;
      body.load("text");
      return context
        .sync()
        .then(function () {
          var text = body.text;
          var pat =
            /\b(HRMS|LRMS|GCMS|MS|ESI-MS|HRESI-MS|MALDI-MS|DART-MS|DESI-MS|LCMS|EI-MS|CI-MS|FAB-MS|HR-FABMS)\b.*(\d{2,5}\.\d{3,6})/gim;
          var matches = text.match(pat) || [];
          if (index - 1 < matches.length) {
            var searchText = matches[index - 1];
            var anchorRegex =
              /(HRMS|LRMS|GCMS|MS|ESI-MS|HRESI-MS|MALDI-MS|DART-MS|DESI-MS|LCMS|EI-MS|CI-MS|FAB-MS|HR-FABMS)[^,]*,\s*\S+\s+\d+\.\d+/i;
            var anchorMatch = searchText.match(anchorRegex);
            if (anchorMatch) {
              searchText = anchorMatch[0];
            } else if (searchText.length > 100) {
              searchText = searchText.substring(0, 100);
            }
            var offset = matches.slice(0, index - 1).filter((item) => item === searchText).length;
            var searchResults = body.search(searchText, { matchCase: false });
            searchResults.load("items");
            return context.sync().then(function () {
              if (searchResults.items.length > offset) {
                searchResults.items[offset].select();
              }
            });
          }
        })
        .catch(function (error) {
          console.error("Error in jumpToText:", error);
        });
    });
  };
})();
