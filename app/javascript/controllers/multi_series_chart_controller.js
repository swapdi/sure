import { Controller } from "@hotwired/stimulus";
import * as d3 from "d3";
import { CHART_TOOLTIP_CLASSES } from "utils/chart_tooltip";

const parseLocalDate = d3.timeParse("%Y-%m-%d");

// Line chart with several series (e.g. "all accounts" plus one per account)
// and several metrics per point (e.g. performance %, gain, value).
//
// One series is active at a time and drawn in full; the others can be shown as
// faint background lines. Metrics either read a point field directly or derive
// from one ("delta" = change since the first point, "relative" = change in %).
//
// data:    { currency, lines: [{ key, name, color, points: [{ date, ...fields }] }] }
// metrics: [{ key, field, transform: "none"|"delta"|"relative", format: "money"|"percent" }]
//
// Other elements can switch the active series by dispatching
// `multi-series-chart:select` on window with detail { chart: <element id>, line: <key> }.
export default class extends Controller {
  static targets = [
    "chart",
    "metricButton",
    "lineButton",
    "lineLabel",
    "lineSwatch",
    "visibilityToggle",
    "backgroundToggle",
    "summary",
    "summaryChange",
    "summaryTrend",
    "linked",
  ];

  static values = {
    data: Object,
    metrics: Array,
    metric: String,
    line: String,
    background: { type: Boolean, default: false },
    allLabel: { type: String, default: "All" },
    locale: String,
    selectable: { type: Boolean, default: false },
  };

  _tooltip = null;
  _resizeObserver = null;
  // Lines the user switched off as background lines (keys).
  _hiddenLines = new Set();

  connect() {
    if (!this.lineValue) this.lineValue = this._lines[0]?.key || "";
    if (!this.metricValue) this.metricValue = this.metricsValue[0]?.key || "";

    this._resizeObserver = new ResizeObserver(() => this._draw());
    this._resizeObserver.observe(this.chartTarget);
    window.addEventListener(
      "multi-series-chart:select",
      this._onExternalSelect,
    );
    this._refresh();
  }

  disconnect() {
    this._resizeObserver?.disconnect();
    window.removeEventListener(
      "multi-series-chart:select",
      this._onExternalSelect,
    );
  }

  selectMetric(event) {
    this.metricValue = event.params.metric;
    this._refresh();
  }

  selectLine(event) {
    this.lineValue = event.params.line;
    this._refresh();
  }

  toggleBackground(event) {
    this.backgroundValue = event.target.checked;
    this._refresh();
  }

  // Show or hide one background line; the picker stays open for more toggles.
  toggleLine(event) {
    event.stopPropagation();
    const key = event.params.line;
    if (this._hiddenLines.has(key)) {
      this._hiddenLines.delete(key);
    } else {
      this._hiddenLines.add(key);
    }
    this._refresh();
  }

  _onExternalSelect = (event) => {
    if (event.detail?.chart !== this.element.id) return;
    if (!this._lines.some((l) => l.key === event.detail.line)) return;

    this.lineValue = event.detail.line;
    this._refresh();
    this.element.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  _refresh() {
    this._syncControls();
    this._renderSummary();
    this._draw();
  }

  // ---------- data ----------

  get _lines() {
    return (this.dataValue.lines || []).map((line) => ({
      ...line,
      points: line.points.map((p) => ({ ...p, date: parseLocalDate(p.date) })),
    }));
  }

  get _metric() {
    return (
      this.metricsValue.find((m) => m.key === this.metricValue) ||
      this.metricsValue[0]
    );
  }

  get _activeLine() {
    const lines = this._lines;
    return lines.find((l) => l.key === this.lineValue) || lines[0];
  }

  _valuesFor(line, metric = this._metric) {
    const raw = line.points.map((p) => Number(p[metric.field]));
    const first = raw[0];

    return line.points.map((p, i) => {
      let value = raw[i];
      if (metric.transform === "delta") value = raw[i] - first;
      // Relative to the absolute start value, so a negative start (e.g. net
      // worth below zero) still reads as a gain when the line goes up.
      if (metric.transform === "relative")
        value = first ? (raw[i] - first) / Math.abs(first) : 0;
      return { date: p.date, value };
    });
  }

  _lineColor(line, values) {
    if (line.key !== "all" && line.color) return line.color;

    const first = values[0]?.value ?? 0;
    const last = values[values.length - 1]?.value ?? 0;
    if (last > first) return "var(--color-success)";
    if (last < first) return "var(--color-destructive)";
    return "var(--color-gray-400)";
  }

  // ---------- formatting ----------

  get _locale() {
    return this.localeValue || document.documentElement.lang || undefined;
  }

  _format(value, format = this._metric.format, { signed = false } = {}) {
    const locale = this._locale;

    if (format === "percent") {
      return new Intl.NumberFormat(locale, {
        style: "percent",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        signDisplay: signed ? "exceptZero" : "auto",
      }).format(value);
    }

    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: this.dataValue.currency || "EUR",
      maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
      signDisplay: signed ? "exceptZero" : "auto",
    }).format(value);
  }

  _formatDate(date) {
    const locale = this._locale;
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      date,
    );
  }

  _signed(metric) {
    return (
      metric.transform !== "none" ||
      metric.format === "percent" ||
      metric.field === "gain"
    );
  }

  // ---------- controls + summary ----------

  _syncControls() {
    for (const button of this.metricButtonTargets) {
      const active =
        button.dataset.multiSeriesChartMetricParam === this.metricValue;
      button.classList.toggle("segmented-control__segment--active", active);
      button.setAttribute("aria-pressed", String(active));
    }

    // Line picker: dropdown options with a check mark on the active line.
    for (const button of this.lineButtonTargets) {
      const active =
        button.dataset.multiSeriesChartLineParam === this._activeLine?.key;
      button.setAttribute("aria-current", String(active));
      button
        .querySelector("[data-check]")
        ?.classList.toggle("invisible", !active);
    }

    const line = this._activeLine;
    if (line && this.hasLineLabelTarget) {
      this.lineLabelTarget.textContent = line.name || this.allLabelValue;
    }
    if (line && this.hasLineSwatchTarget) {
      this.lineSwatchTarget.style.background =
        line.color || "var(--color-gray-400)";
    }

    if (this.hasBackgroundToggleTarget) {
      this.backgroundToggleTarget.checked = this.backgroundValue;
    }

    // Eye toggles only exist while background lines are on. The active line
    // is always drawn, so its toggle is disabled and shows as visible.
    for (const toggle of this.visibilityToggleTargets) {
      const key = toggle.dataset.multiSeriesChartLineParam;
      const isActive = key === this._activeLine?.key;
      const visible = isActive || !this._hiddenLines.has(key);

      toggle.hidden = !this.backgroundValue;
      toggle.disabled = isActive;
      toggle.setAttribute("aria-pressed", String(visible));
      toggle.querySelector("[data-eye-on]").hidden = !visible;
      toggle.querySelector("[data-eye-off]").hidden = visible;
      toggle
        .closest("[data-line-row]")
        ?.querySelector("[data-line-name]")
        ?.classList.toggle("opacity-50", this.backgroundValue && !visible);
    }

    // Elements tied to one series (e.g. a holdings table per account) are only
    // shown while that series is active.
    for (const el of this.linkedTargets) {
      el.hidden = el.dataset.line !== this._activeLine?.key;
    }
  }

  _renderSummary() {
    const line = this._activeLine;
    if (!line || !this.hasSummaryTarget) return;

    const values = this._valuesFor(line);
    const last = values[values.length - 1]?.value ?? 0;
    this.summaryTarget.textContent = this._format(last, this._metric.format, {
      signed: this._signed(this._metric),
    });
    this.summaryTarget.style.color = this._signed(this._metric)
      ? this._lineColor({ key: "all" }, values)
      : "";

    if (this.hasSummaryChangeTarget) {
      this.summaryChangeTarget.textContent = line.name || this.allLabelValue;
    }

    // Change over the period in the base unit, independent of the selected metric.
    if (this.hasSummaryTrendTarget) {
      const base = { field: this.metricsValue[0].field, transform: "none" };
      const raw = this._valuesFor(line, base);
      const first = raw[0]?.value ?? 0;
      const lastRaw = raw[raw.length - 1]?.value ?? 0;
      const delta = lastRaw - first;
      const relative = first ? delta / Math.abs(first) : 0;

      this.summaryTrendTarget.textContent = `${this._format(delta, "money", { signed: true })} (${this._format(relative, "percent", { signed: true })})`;
      this.summaryTrendTarget.style.color = this._lineColor(
        { key: "all" },
        raw,
      );
    }
  }

  // ---------- drawing ----------

  _draw() {
    const container = this.chartTarget;
    d3.select(container).selectAll("*").remove();
    this._tooltip = null;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const active = this._activeLine;
    if (!active || width < 50 || height < 50 || active.points.length < 2)
      return;

    const margin = { top: 12, right: 56, bottom: 22, left: 0 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const lines = this._lines;
    const background = this.backgroundValue
      ? lines.filter(
          (l) =>
            l.key !== active.key &&
            !this._hiddenLines.has(l.key) &&
            l.points.length > 1,
        )
      : [];
    const activeValues = this._valuesFor(active);
    const backgroundSeries = background.map((line) => ({
      line,
      values: this._valuesFor(line),
    }));

    const allValues = [
      activeValues,
      ...backgroundSeries.map((s) => s.values),
    ].flat();
    const x = d3
      .scaleTime()
      .domain(d3.extent(allValues, (d) => d.date))
      .range([0, innerW]);

    let [yMin, yMax] = d3.extent(allValues, (d) => d.value);
    if (
      this._metric.transform !== "none" ||
      this._metric.format === "percent" ||
      this._metric.field === "gain"
    ) {
      yMin = Math.min(yMin, 0);
      yMax = Math.max(yMax, 0);
    }
    const pad = (yMax - yMin) * 0.08 || Math.abs(yMax) * 0.1 || 1;
    const y = d3
      .scaleLinear()
      .domain([yMin - pad, yMax + pad])
      .range([innerH, 0]);

    const svg = d3
      .select(container)
      .append("svg")
      .attr("width", width)
      .attr("height", height);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // y ticks on the right
    const ticks = y.ticks(4);
    g.append("g")
      .selectAll("line")
      .data(ticks)
      .join("line")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", (d) => y(d))
      .attr("y2", (d) => y(d))
      .attr("stroke", "currentColor")
      .attr("class", "text-gray-200")
      .attr("stroke-dasharray", (d) => (d === 0 ? null : "2,4"))
      .attr("stroke-opacity", (d) => (d === 0 ? 0.9 : 0.6));

    g.append("g")
      .selectAll("text")
      .data(ticks)
      .join("text")
      .attr("x", innerW + 8)
      .attr("y", (d) => y(d))
      .attr("dy", "0.32em")
      .attr("class", "fill-current text-secondary privacy-sensitive")
      .style("font-size", "11px")
      .text((d) => this._formatTick(d));

    // x labels: first and last date
    const [d0, d1] = x.domain();
    g.append("text")
      .attr("x", 0)
      .attr("y", innerH + 16)
      .attr("class", "fill-current text-secondary")
      .style("font-size", "11px")
      .text(this._formatDate(d0));
    g.append("text")
      .attr("x", innerW)
      .attr("y", innerH + 16)
      .attr("text-anchor", "end")
      .attr("class", "fill-current text-secondary")
      .style("font-size", "11px")
      .text(this._formatDate(d1));

    const lineGen = d3
      .line()
      .x((d) => x(d.date))
      .y((d) => y(d.value))
      .curve(d3.curveMonotoneX);

    for (const { line, values } of backgroundSeries) {
      g.append("path")
        .datum(values)
        .attr("fill", "none")
        .attr("stroke", this._lineColor(line, values))
        .attr("stroke-width", 1.25)
        .attr("stroke-opacity", 0.45)
        .attr("d", lineGen);
    }

    const activeColor = this._lineColor(active, activeValues);

    // soft area under the active line
    const gradientId = `${this.element.id}-gradient`;
    const gradient = svg
      .append("defs")
      .append("linearGradient")
      .attr("id", gradientId)
      .attr("x1", 0)
      .attr("x2", 0)
      .attr("y1", 0)
      .attr("y2", 1);
    gradient
      .append("stop")
      .attr("offset", 0)
      .attr("stop-color", activeColor)
      .attr("stop-opacity", 0.12);
    gradient
      .append("stop")
      .attr("offset", 1)
      .attr("stop-color", activeColor)
      .attr("stop-opacity", 0);

    const baseline = y(Math.max(y.domain()[0], Math.min(0, y.domain()[1])));
    g.append("path")
      .datum(activeValues)
      .attr("fill", `url(#${gradientId})`)
      .attr(
        "d",
        d3
          .area()
          .x((d) => x(d.date))
          .y0(
            this._metric.format === "percent" ||
              this._metric.transform !== "none"
              ? baseline
              : innerH,
          )
          .y1((d) => y(d.value))
          .curve(d3.curveMonotoneX),
      );

    g.append("path")
      .datum(activeValues)
      .attr("fill", "none")
      .attr("stroke", activeColor)
      .attr("stroke-width", 2)
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("d", lineGen);

    this._drawHover(g, svg, {
      x,
      y,
      innerW,
      innerH,
      margin,
      active,
      activeValues,
      activeColor,
      backgroundSeries,
    });
  }

  _formatTick(value) {
    const metric = this._metric;
    const locale = this._locale;
    if (metric.format === "percent") {
      return new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: 0,
      }).format(value);
    }
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: this.dataValue.currency || "EUR",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }

  _drawHover(g, svg, ctx) {
    const {
      x,
      y,
      innerW,
      innerH,
      margin,
      active,
      activeValues,
      activeColor,
      backgroundSeries,
    } = ctx;

    this._tooltip = d3
      .select(this.chartTarget)
      .append("div")
      .attr("class", `${CHART_TOOLTIP_CLASSES} opacity-0 top-0`)
      .style("position", "fixed")
      .style("pointer-events", "none");

    const guide = g
      .append("line")
      .attr("class", "text-subdued")
      .attr("stroke", "currentColor")
      .attr("stroke-dasharray", "4,4")
      .attr("y1", 0)
      .attr("y2", innerH)
      .style("display", "none");
    const dot = g
      .append("circle")
      .attr("r", 4.5)
      .attr("fill", activeColor)
      .style("display", "none");
    const bisect = d3.bisector((d) => d.date).center;

    const hide = () => {
      guide.style("display", "none");
      dot.style("display", "none");
      this._tooltip?.style("opacity", 0);
    };

    const show = (event) => {
      if (!event || (typeof event.clientX !== "number" && !event.touches))
        return;

      const [mx] = d3.pointer(event, g.node());
      const i = bisect(activeValues, x.invert(mx));
      const datum = activeValues[i];
      if (!datum) return;

      const cx = x(datum.date);
      guide.attr("x1", cx).attr("x2", cx).style("display", null);
      dot.attr("cx", cx).attr("cy", y(datum.value)).style("display", null);

      const metric = this._metric;
      const signed = this._signed(metric);
      const rows = [
        {
          name: active.name || this.allLabelValue,
          color: activeColor,
          value: datum.value,
          strong: true,
        },
        ...backgroundSeries
          .map(({ line, values }) => {
            const j = bisect(values, datum.date);
            const v = values[j];
            if (!v || Math.abs(v.date - datum.date) > 3 * 86400000) return null;
            return {
              name: line.name || this.allLabelValue,
              color: this._lineColor(line, values),
              value: v.value,
            };
          })
          .filter(Boolean),
      ];

      const html = `
          <div class="text-xs text-secondary mb-1">${this._formatDate(datum.date)}</div>
          ${rows
            .map(
              (r) => `
            <div class="flex items-center justify-between gap-4 text-sm ${r.strong ? "font-medium text-primary" : "text-secondary"}">
              <span class="flex items-center gap-2"><span class="inline-block w-2 h-2 rounded-full" style="background:${r.color}"></span>${this._escape(r.name)}</span>
              <span class="tabular-nums privacy-sensitive">${this._format(r.value, metric.format, { signed })}</span>
            </div>`,
            )
            .join("")}
        `;

      const pageX = event.touches ? event.touches[0].clientX : event.clientX;
      const pageY = event.touches ? event.touches[0].clientY : event.clientY;
      const tipWidth = 260;
      const left =
        pageX + 12 + tipWidth > window.innerWidth
          ? pageX - tipWidth - 12
          : pageX + 12;
      this._tooltip
        .html(html)
        .style("opacity", 1)
        .style("z-index", 999)
        .style("min-width", "180px")
        .style("left", `${left}px`)
        .style("top", `${pageY - 10}px`);
    };

    if (!this.selectableValue) {
      svg
        .append("rect")
        .attr("transform", `translate(${margin.left},${margin.top})`)
        .attr("width", innerW)
        .attr("height", innerH)
        .attr("fill", "transparent")
        .on("mousemove touchmove", show)
        .on("mouseleave touchend", hide);
      return;
    }

    // Drag across the chart to jump the dashboard to that date range.
    const brush = d3
      .brushX()
      .extent([
        [0, 0],
        [innerW, innerH],
      ])
      // Mouse only, so touch devices keep native scrolling.
      .touchable(false)
      .on("start brush", (event) => show(event.sourceEvent))
      .on("end", (event) => {
        hide();
        if (!event.selection) return;

        const [x0, x1] = event.selection;
        const start = activeValues[bisect(activeValues, x.invert(x0))];
        const end = activeValues[bisect(activeValues, x.invert(x1))];
        if (x1 - x0 < 4 || !start || !end || start === end) {
          brushGroup.call(brush.move, null);
          return;
        }

        const format = d3.timeFormat("%Y-%m-%d");
        const url = new URL(window.location.href);
        url.searchParams.delete("period");
        url.searchParams.set("start_date", format(start.date));
        url.searchParams.set("end_date", format(end.date));
        Turbo.visit(url.toString());
      });

    const brushGroup = g
      .append("g")
      .attr("class", "drag-select-brush")
      .call(brush);
    brushGroup
      .select(".selection")
      .attr("fill", activeColor)
      .attr("fill-opacity", 0.12)
      .attr("stroke", activeColor)
      .attr("stroke-opacity", 0.5);
    brushGroup
      .select(".overlay")
      .on("mousemove.tooltip", show)
      .on("mouseleave.tooltip", hide);
  }

  _escape(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
  }
}
