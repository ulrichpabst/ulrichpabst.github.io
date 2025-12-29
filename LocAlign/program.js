const CONFIG = {
    match: 5,
    mismatch: -4,
    gapOpen: -10,
    gapExt: -2
};

let isCircular = false;

function getEl(id) {
    return document.getElementById(id);
}

function renderStatus(html) {
    const container = getEl("output-container");
    if (!container) return;
    container.innerHTML = html;
}

function renderError(error) {
    const message = (error && error.stack) ? error.stack : String(error);
    console.error(error);
    renderStatus(
        `<div class="empty-state">
            <p style="color:#b91c1c;font-weight:700;">JavaScript error</p>
            <pre style="white-space:pre-wrap;word-break:break-word;margin-top:10px;">${escapeHtml(message)}</pre>
         </div>`
    );
}

function escapeHtml(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

window.addEventListener("DOMContentLoaded", () => {
    const alignBtn = getEl("alignBtn");
    const copyAllBtn = getEl("copyAllBtn");
    const circBtn = getEl("circularBtn");

    if (!alignBtn || !copyAllBtn || !circBtn) {
        renderError(new Error(
            `Missing required element(s): ` +
            `${!alignBtn ? "#alignBtn " : ""}` +
            `${!copyAllBtn ? "#copyAllBtn " : ""}` +
            `${!circBtn ? "#circularBtn " : ""}`
        ));
        return;
    }

    alignBtn.addEventListener("click", () => {
        try {
            runAllAlignments();
        } catch (e) {
            renderError(e);
        }
    });

    copyAllBtn.addEventListener("click", () => {
        try {
            copyFullReport();
        } catch (e) {
            renderError(e);
        }
    });

    circBtn.addEventListener("click", () => {
        isCircular = !isCircular;
        circBtn.textContent = `Circular ${isCircular ? "ON" : "OFF"}`;
        circBtn.classList.toggle("active", isCircular);
    });
});

function parseFasta(text) {
    if (!text) return [];
    const rawEntries = text.split(">");
    const entries = [];
    for (const entry of rawEntries) {
        if (!entry.trim()) continue;
        const lines = entry.split("\n");
        const header = (lines[0] || "").trim();
        const seq = lines.slice(1).join("").replace(/\s+/g, "").toUpperCase();
        if (seq.length > 0) entries.push({ header: header || "(no header)", seq });
    }
    return entries;
}

function runAllAlignments() {
    const rawRef = getEl("reference").value;
    const rawQuery = getEl("query").value;

    const refs = parseFasta(rawRef);
    const queries = parseFasta(rawQuery);
    const container = getEl("output-container");

    container.innerHTML = "";

    if (refs.length === 0 || queries.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>Please input valid FASTA (must start with &gt;header).</p></div>`;
        return;
    }

    let globalReport = `ALIGNMENT JOB REPORT\nGenerated: ${new Date().toLocaleString()}\n\n`;

    for (const refObj of refs) {
        for (const queryObj of queries) {
            const effectiveRefSeq = isCircular ? (refObj.seq + refObj.seq) : refObj.seq;

            const result = smithWaterman(effectiveRefSeq, queryObj.seq);

            const identity = result.length > 0 ? ((result.matches / result.length) * 100) : 0;

            const stats = {
                refName: refObj.header,
                queryName: queryObj.header,
                refLen: refObj.seq.length,
                queryLen: queryObj.seq.length,
                score: result.score,
                mismatches: result.mismatches,
                identity: Number(identity.toFixed(1)),
                gaps: result.gaps
            };

            const textBlock = formatAlignmentText(
                result.alignRef,
                result.alignQuery,
                result.refStart,
                result.queryStart,
                stats,
                isCircular
            );

            globalReport += textBlock + "\n" + "=".repeat(60) + "\n\n";
            createResultCard(container, stats, textBlock);
        }
    }

    container.dataset.fullReport = globalReport;
}

function smithWaterman(s1, s2) {
    const n = s1.length;
    const m = s2.length;

    const H = new Float32Array((n + 1) * (m + 1));
    const D = new Uint8Array((n + 1) * (m + 1));

    const getIdx = (i, j) => i * (m + 1) + j;

    let maxScore = 0;
    let maxI = 0;
    let maxJ = 0;

    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const matchScore = (s1[i - 1] === s2[j - 1]) ? CONFIG.match : CONFIG.mismatch;

            const scoreDiag = H[getIdx(i - 1, j - 1)] + matchScore;
            const scoreUp = H[getIdx(i - 1, j)] + CONFIG.gapOpen;
            const scoreLeft = H[getIdx(i, j - 1)] + CONFIG.gapOpen;

            const score = Math.max(0, scoreDiag, scoreUp, scoreLeft);
            const idx = getIdx(i, j);
            H[idx] = score;

            if (score === 0) D[idx] = 0;
            else if (score === scoreDiag) D[idx] = 1;
            else if (score === scoreUp) D[idx] = 2;
            else D[idx] = 3;

            if (score > maxScore) {
                maxScore = score;
                maxI = i;
                maxJ = j;
            }
        }
    }

    let align1 = "";
    let align2 = "";
    let i = maxI;
    let j = maxJ;

    let matches = 0;
    let mismatches = 0;
    let gaps = 0;
    let length = 0;

    while (i > 0 && j > 0 && H[getIdx(i, j)] > 0) {
        length++;
        const dir = D[getIdx(i, j)];

        if (dir === 1) {
            if (s1[i - 1] === s2[j - 1]) {
                matches++;
            } else {
                mismatches++;
            }
            align1 = s1[i - 1] + align1;
            align2 = s2[j - 1] + align2;
            i--;
            j--;
        } else if (dir === 2) {
            align1 = s1[i - 1] + align1;
            align2 = "-" + align2;
            gaps++;
            i--;
        } else {
            align1 = "-" + align1;
            align2 = s2[j - 1] + align2;
            gaps++;
            j--;
        }
    }

    return {
        alignRef: align1,
        alignQuery: align2,
        score: maxScore,
        matches,
        mismatches,
        length,
        gaps,
        refStart: i + 1,
        queryStart: j + 1
    };
}

function formatAlignmentText(ref, query, rStart, qStart, stats, isCirc) {
    let output = "";
    output += `REFERENCE   :  ${stats.refName} (${stats.refLen} bp)\n`;
    output += `QUERY       :  ${stats.queryName} (${stats.queryLen} bp)\n`;
    output += `------------------------------------------------------------\n`;
    output += `Identity    :  ${stats.identity}%\n`;
    output += `Score       :  ${stats.score}\n`;
    output += `Gaps        :  ${stats.gaps}\n`;
    output += `Mismatches  :  ${stats.mismatches}\n`;
    output += `------------------------------------------------------------\n\n`;

    const blockLen = 60;
    let rPos = rStart;
    let qPos = qStart;

    for (let k = 0; k < ref.length; k += blockLen) {
        const rSub = ref.substring(k, k + blockLen);
        const qSub = query.substring(k, k + blockLen);

        let matchLine = "";
        let rAdv = 0;
        let qAdv = 0;

        for (let x = 0; x < rSub.length; x++) {
            const rChar = rSub[x];
            const qChar = qSub[x];
            matchLine += (rChar === qChar) ? "|" : ((rChar === "-" || qChar === "-") ? " " : ".");
            if (rChar !== "-") rAdv++;
            if (qChar !== "-") qAdv++;
        }

        let displayR = rPos;
        if (isCirc && displayR > stats.refLen) {
            displayR = ((displayR - 1) % stats.refLen) + 1;
        }

        const rPre = `REF   ${String(displayR).padEnd(5)} `;
        const qPre = `QRY   ${String(qPos).padEnd(5)} `;
        const mPad = " ".repeat(rPre.length);

        output += `${rPre}${rSub}\n${mPad}${matchLine}\n${qPre}${qSub}\n`;

        rPos += rAdv;
        qPos += qAdv;
    }

    return output;
}

function createResultCard(container, stats, textContent) {
    const div = document.createElement("div");
    div.className = "result-card";

    const idColor = stats.identity >= 100 ? "#10b981" : (stats.identity >= 90 ? "#3b82f6" : "#f59e0b");

    div.innerHTML = `
        <div class="card-header">
            <div class="seq-names">
                ${escapeHtml(stats.refName)} <span>vs</span> ${escapeHtml(stats.queryName)}
            </div>
            <div class="metrics">
                <div class="metric-box">
                    <label>Identity</label>
                    <span style="color: ${idColor}">${stats.identity}%</span>
                </div>
                <div class="metric-box">
                    <label>Score</label>
                    <span>${stats.score}</span>
                </div>
            </div>
        </div>
        <div class="alignment-view">
            <pre>${escapeHtml(textContent)}</pre>
        </div>
    `;
    container.appendChild(div);
}

function copyFullReport() {
    const container = getEl("output-container");
    const text = container?.dataset?.fullReport;

    if (!text) return;

    const btn = getEl("copyAllBtn");
    const orig = btn.textContent;

    const done = () => {
        btn.textContent = "COPIED";
        setTimeout(() => btn.textContent = orig, 1500);
    };

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done).catch(renderError);
        return;
    }

    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand("copy");
        done();
    } finally {
        document.body.removeChild(ta);
    }
}
