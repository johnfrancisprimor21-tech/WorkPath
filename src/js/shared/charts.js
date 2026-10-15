const CHART_COLORS = ['var(--color-primary)', 'var(--chart-series-secondary)'];

/** Build an accessible responsive SVG grouped bar chart and a matching data table. */
export function barChart({ labels = [], series = [], valueFormat, ariaLabel = 'Bar chart' } = {}) {
  if (series.length > 2) throw new RangeError('Bar charts support one or two series.');
  const safeLabels = labels.map((label) => String(label ?? ''));
  const safeSeries = series.map((item) => ({
    name: String(item?.name ?? 'Series'),
    values: safeLabels.map((_, index) => normalizeValue(item?.values?.[index]))
  }));
  const compactValues = safeLabels.length * Math.max(1, safeSeries.length) > 8;
  const dataTable = makeTable(safeLabels, safeSeries, valueFormat);
  if (!safeLabels.length) return emptyChart(ariaLabel, dataTable);

  const width = 640;
  const height = 250;
  const padding = { top: 28, right: 16, bottom: 56, left: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const allValues = safeSeries.flatMap((item) => item.values).filter((value) => value !== null);
  const maxValue = Math.max(1, ...allValues);
  const groupWidth = plotWidth / safeLabels.length;
  const barsPerGroup = Math.max(1, safeSeries.length);
  const barSlot = Math.min(groupWidth * 0.8 / barsPerGroup, 38);
  const barWidth = Math.max(2, barSlot * 0.72);
  let marks = `<line class="chart-baseline" x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" />`;

  for (let labelIndex = 0; labelIndex < safeLabels.length; labelIndex += 1) {
    const center = padding.left + groupWidth * (labelIndex + 0.5);
    const groupStart = center - (barSlot * barsPerGroup) / 2;
    for (let seriesIndex = 0; seriesIndex < safeSeries.length; seriesIndex += 1) {
      const value = safeSeries[seriesIndex].values[labelIndex];
      const x = groupStart + seriesIndex * barSlot + (barSlot - barWidth) / 2;
      if (value === null) {
        marks += `<text class="chart-none" x="${x + barWidth / 2}" y="${padding.top + plotHeight - 6}" text-anchor="middle">—</text>`;
        continue;
      }
      const barHeight = value === 0 ? 1 : Math.max(2, value / maxValue * plotHeight);
      const y = padding.top + plotHeight - barHeight;
      const label = formatValue(value, valueFormat, compactValues);
      marks += `<rect class="chart-bar" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3" style="fill:${CHART_COLORS[seriesIndex]}" />`;
      marks += `<text class="chart-value" x="${x + barWidth / 2}" y="${Math.max(12, y - 5)}" text-anchor="middle">${escapeHtml(label)}</text>`;
    }
    const shortLabel = compactLabel(safeLabels[labelIndex], safeLabels.length > 6 ? 10 : 16);
    marks += `<text class="chart-category" x="${center}" y="${height - 22}" text-anchor="middle">${escapeHtml(shortLabel)}</text>`;
  }

  const legend = safeSeries.length > 1 ? `<g class="chart-legend">${safeSeries.map((item, index) => {
    const x = padding.left + index * 195;
    return `<rect x="${x}" y="7" width="10" height="10" rx="2" style="fill:${CHART_COLORS[index]}" /><text x="${x + 15}" y="16">${escapeHtml(item.name)}</text>`;
  }).join('')}</g>` : '';
  return `<figure class="stats-chart" aria-label="${escapeHtml(ariaLabel)}"><svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeHtml(ariaLabel)}" xmlns="http://www.w3.org/2000/svg">${legend}${marks}</svg>${dataTable}</figure>`;
}

/** Build an accessible responsive horizontal bar chart and a matching data table. */
export function horizontalBars({ labels = [], values = [], valueFormat, ariaLabel = 'Horizontal bar chart' } = {}) {
  const safeLabels = labels.map((label) => String(label ?? ''));
  const safeValues = safeLabels.map((_, index) => normalizeValue(values[index]));
  const dataTable = makeTable(safeLabels, [{ name: 'Count', values: safeValues }], valueFormat);
  if (!safeLabels.length) return emptyChart(ariaLabel, dataTable);

  const width = 640;
  const rowHeight = 46;
  const height = Math.max(86, 24 + rowHeight * safeLabels.length);
  const labelWidth = 150;
  const plotWidth = width - labelWidth - 50;
  const maxValue = Math.max(1, ...safeValues.filter((value) => value !== null));
  let marks = '';
  for (let index = 0; index < safeLabels.length; index += 1) {
    const y = 14 + index * rowHeight;
    const value = safeValues[index];
    marks += `<text class="chart-category chart-row-label" x="0" y="${y + 18}">${escapeHtml(compactLabel(safeLabels[index], 22))}</text>`;
    if (value === null) {
      marks += `<text class="chart-none" x="${labelWidth + 8}" y="${y + 18}">—</text>`;
      continue;
    }
    const barWidth = value === 0 ? 1 : Math.max(2, value / maxValue * plotWidth);
    marks += `<rect class="chart-bar" x="${labelWidth}" y="${y}" width="${barWidth}" height="24" rx="5" style="fill:${CHART_COLORS[0]}" />`;
    marks += `<text class="chart-value chart-row-value" x="${Math.min(width - 28, labelWidth + barWidth + 8)}" y="${y + 17}">${escapeHtml(formatValue(value, valueFormat, safeLabels.length > 8))}</text>`;
  }
  return `<figure class="stats-chart" aria-label="${escapeHtml(ariaLabel)}"><svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeHtml(ariaLabel)}" xmlns="http://www.w3.org/2000/svg">${marks}</svg>${dataTable}</figure>`;
}

function makeTable(labels, series, valueFormat) {
  const headers = series.map((item) => `<th scope="col">${escapeHtml(item.name)}</th>`).join('');
  const rows = labels.map((label, index) => `<tr><th scope="row">${escapeHtml(label)}</th>${series.map((item) => {
    const value = item.values[index];
    return `<td>${value === null ? 'None' : escapeHtml(formatValue(value, valueFormat, false))}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="stats-chart-data-table"><caption>Chart data</caption><thead><tr><th scope="col">Label</th>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

function emptyChart(ariaLabel, table) {
  return `<figure class="stats-chart" aria-label="${escapeHtml(ariaLabel)}"><p class="chart-empty">No data to chart.</p>${table}</figure>`;
}

function normalizeValue(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : null;
}

function formatValue(value, valueFormat, compact) {
  if (typeof valueFormat === 'function') {
    try {
      return String(valueFormat(value, { compact }));
    } catch {
      return String(value);
    }
  }
  if (compact) return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return String(value);
}

function compactLabel(value, maxLength) {
  const characters = Array.from(value);
  return characters.length > maxLength ? characters.slice(0, maxLength - 1).join('') + '…' : value;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}
