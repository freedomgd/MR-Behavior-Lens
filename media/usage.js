/* global acquireVsCodeApi */
(function () {
  const vscode = acquireVsCodeApi();
  const fmt = (n) => n.toLocaleString('en-US');
  const tooltip = document.getElementById('tooltip');

  document.getElementById('clear').addEventListener('click', () => {
    vscode.postMessage({ type: 'clear' });
  });

  function seriesColor(name) {
    return getComputedStyle(document.body).getPropertyValue(
      name === 'input' ? '--series-input' : '--series-output'
    ).trim();
  }

  function renderTiles(records) {
    const now = Date.now();
    const dayStart = new Date().setHours(0, 0, 0, 0);
    const weekStart = now - 7 * 864e5;
    const bucket = (pred) => {
      const t = { input: 0, output: 0, requests: 0 };
      for (const r of records) {
        if (!pred(r)) continue;
        t.input += r.inputTokens;
        t.output += r.outputTokens;
        t.requests++;
      }
      return t;
    };
    const tiles = [
      ['Today', bucket((r) => r.ts >= dayStart)],
      ['Last 7 days', bucket((r) => r.ts >= weekStart)],
      ['All time', bucket(() => true)],
    ];
    document.getElementById('tiles').innerHTML = tiles
      .map(
        ([label, t]) => `<div class="tile">
          <div class="label">${label}</div>
          <div class="value">${fmt(t.input + t.output)}</div>
          <div class="sub">${fmt(t.input)} in · ${fmt(t.output)} out · ${t.requests} req</div>
        </div>`
      )
      .join('');
  }

  function renderChart(records) {
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      days.push({ start: d.getTime(), label: `${d.getMonth() + 1}/${d.getDate()}`, input: 0, output: 0 });
    }
    for (const r of records) {
      for (const day of days) {
        if (r.ts >= day.start && r.ts < day.start + 864e5) {
          day.input += r.inputTokens;
          day.output += r.outputTokens;
        }
      }
    }
    document.getElementById('legend').innerHTML = `
      <span><span class="swatch" style="background:${seriesColor('input')}"></span>Input tokens</span>
      <span><span class="swatch" style="background:${seriesColor('output')}"></span>Output tokens</span>`;

    const W = 560, H = 160, pad = { l: 8, r: 8, t: 8, b: 18 };
    const bw = (W - pad.l - pad.r) / days.length;
    const max = Math.max(1, ...days.map((d) => d.input + d.output));
    const y = (v) => (H - pad.b) - (v / max) * (H - pad.t - pad.b);

    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily token usage, last 14 days">`;
    svg += `<line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" stroke="var(--baseline)" stroke-width="1"/>`;
    days.forEach((d, i) => {
      const x = pad.l + i * bw + bw * 0.18;
      const w = bw * 0.64;
      const total = d.input + d.output;
      if (total > 0) {
        const yIn = y(d.input);
        const yTop = y(total);
        // input segment (baseline-anchored, rounded only if it's the top segment)
        svg += `<g class="bar" data-i="${i}">`;
        svg += `<rect x="${x}" y="${yIn}" width="${w}" height="${(H - pad.b) - yIn}" fill="${seriesColor('input')}"${d.output === 0 ? ' rx="3"' : ''}/>`;
        if (d.output > 0) {
          // 2px surface gap between stacked segments
          svg += `<rect x="${x}" y="${yTop}" width="${w}" height="${Math.max(1, yIn - yTop - 2)}" rx="3" fill="${seriesColor('output')}"/>`;
        }
        svg += `</g>`;
      }
      if (i % 2 === 0) {
        svg += `<text x="${pad.l + i * bw + bw / 2}" y="${H - 5}" text-anchor="middle">${d.label}</text>`;
      }
    });
    svg += `</svg>`;
    const holder = document.getElementById('chart');
    holder.innerHTML = svg;

    holder.querySelectorAll('.bar').forEach((g) => {
      g.addEventListener('mousemove', (e) => {
        const d = days[Number(g.dataset.i)];
        tooltip.innerHTML = `<b>${d.label}</b><br>${fmt(d.input)} in · ${fmt(d.output)} out`;
        tooltip.hidden = false;
        tooltip.style.left = `${e.clientX + 12}px`;
        tooltip.style.top = `${e.clientY + 12}px`;
      });
      g.addEventListener('mouseleave', () => (tooltip.hidden = true));
    });
  }

  function renderTables(records) {
    const byMr = new Map();
    for (const r of records) {
      const t = byMr.get(r.mrRef) || { input: 0, output: 0, requests: 0 };
      t.input += r.inputTokens;
      t.output += r.outputTokens;
      t.requests++;
      byMr.set(r.mrRef, t);
    }
    document.querySelector('#byMr tbody').innerHTML =
      [...byMr.entries()]
        .sort((a, b) => b[1].input + b[1].output - (a[1].input + a[1].output))
        .map(
          ([mr, t]) =>
            `<tr><td>${mr}</td><td class="num">${t.requests}</td><td class="num">${fmt(t.input)}</td><td class="num">${fmt(t.output)}</td></tr>`
        )
        .join('') || '<tr><td colspan="4" class="empty">No usage yet</td></tr>';

    document.querySelector('#recent tbody').innerHTML =
      [...records]
        .slice(-50)
        .reverse()
        .map((r) => {
          const est = r.estimated ? ' <span class="estimated">(est.)</span>' : '';
          return `<tr><td>${new Date(r.ts).toLocaleString()}</td><td>${r.provider}</td><td>${r.model}</td><td>${r.stage}</td><td class="num">${fmt(r.inputTokens)}${est}</td><td class="num">${fmt(r.outputTokens)}${est}</td></tr>`;
        })
        .join('') || '<tr><td colspan="6" class="empty">No usage yet</td></tr>';
  }

  window.addEventListener('message', (event) => {
    if (event.data.type !== 'data') return;
    const records = event.data.records;
    renderTiles(records);
    renderChart(records);
    renderTables(records);
  });

  vscode.postMessage({ type: 'ready' });
})();
